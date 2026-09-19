#!/usr/bin/env bash
#
# One-click Cloudflare Pages bootstrap/publish for the hashed static assets of
# the store SPA and the monitor SPA (DEPLOYMENT.md "Static assets on
# Cloudflare Pages" — the first-visit 522 fix). One script, two targets:
#
#   store (default)     — store-web SPA, assets domain e.g. assets.example.com,
#                         Pages project infinia-assets
#   monitor (--monitor) — monitor-web SPA (split deployment's monitor host),
#                         staged under the /monitor subtree of the SAME Pages
#                         project/domain as the store by default (e.g.
#                         https://asset.example.com/monitor on project
#                         infinia-assets) — or its own project/domain by
#                         setting deploy.conf accordingly on that host.
#
# The host is auto-detected (store host / monitor host by its compose project;
# anything else builds in a throwaway node container). Full run per target,
# in order: configure (questionnaire when values are missing — saved to
# deploy.conf) → build & publish (on the target's host: extracted from the
# freshly built image's jar, byte-identical to what it will serve) → attach
# the custom domain via the Cloudflare API → wait until the domain serves the
# files → switch the container (target host only) → health wait.
#
# Configuration — precedence: flags > environment variables > deploy.conf >
# built-in defaults. deploy.conf (repo root, gitignored, mode 600) carries:
#
#   ASSETS_BASE_URL=https://assets.example.com   # this host's assets origin
#   ASSETS_PAGES_PROJECT=infinia-assets          # or infinia-monitor-assets
#   CLOUDFLARE_ACCOUNT_ID=<id>                   # required
#   CLOUDFLARE_API_TOKEN=<token>                 # required; Pages · Edit
#   NPM_CONFIG_REGISTRY=https://registry.npmmirror.com   # optional
#   NODE_IMAGE=node:22-alpine                    # optional
#
# Interactive: on a terminal, missing required values trigger a questionnaire
# that can save the answers to deploy.conf. `--configure` runs ONLY that
# questionnaire (answers can be piped for pre-provisioning). Unattended runs
# never prompt — missing values fail fast with fix hints.
#
# Usage:
#   scripts/deploy-assets.sh --all              # store target, everything
#   scripts/deploy-assets.sh --monitor --all    # monitor target, everything
#   scripts/deploy-assets.sh                    # publish + attach, then --switch
#   scripts/deploy-assets.sh --dist store-web/dist     # publish-only
#   scripts/deploy-assets.sh --configure               # interactive setup only
#
# Options:
#   --all              do everything end-to-end (implies --switch on the
#                      target's host; elsewhere it publishes + attaches and
#                      prints the final command to run on the server)
#   --monitor          target the monitor SPA / monitor host (also
#                      auto-detected on a monitor-only host)
#   --base-url URL     assets origin (or ASSETS_BASE_URL env / deploy.conf /
#                      the existing .env on the target host)
#   --dist DIR         publish a COMPLETE Pages tree and exit (no build,
#                      no remote retention, no .env changes, no --switch)
#   --project NAME     Pages project (default infinia-assets, or
#                      infinia-monitor-assets for a dedicated monitor origin)
#   --switch           after publishing, recreate the target's container with
#                      the new image — only once the domain serves the files
#   --wait-assets      verify the domain serves the exact bundle before exiting
#   --configure        run the interactive questionnaire, save deploy.conf, exit
#   --from-image       force the host path (extract from built image)
#   --from-build       force the container-build path (any host)
#   --keep-dir         keep the temporary publish directory (debugging)
#   --fresh-project    first publish to an empty project; skip remote retention
#   --previous-dist DIR complete prior Pages tree for migration (before manifests)
#
# Idempotent: re-running rebuilds (layer-cached), re-extracts and re-publishes
# with a file manifest to retain previously published hashed assets.
# upgrade.sh publishes and verifies assets before switching containers whenever
# ASSETS_BASE_URL is active (.env); credentials may come from env or deploy.conf.
# Serialize publishes from different hosts that share the same Pages project.
set -euo pipefail
cd "$(dirname "$0")/.."

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

BASE_URL=""
PROJECT=""
MODE=auto
TARGET=auto
DIST_ARG=""
SWITCH=0
WAIT_ASSETS=0
KEEP_DIR=0
FRESH_PROJECT=0
PREVIOUS_DIST=""
CONFIGURE=0
ALL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url)   BASE_URL=${2:?}; shift 2 ;;
    --dist)       DIST_ARG=${2:?}; shift 2 ;;
    --project)    PROJECT=${2:?}; shift 2 ;;
    --switch)     SWITCH=1; shift ;;
    --wait-assets) WAIT_ASSETS=1; shift ;;
    --all)        ALL=1; SWITCH=1; shift ;;
    --monitor)    TARGET=monitor; shift ;;
    --configure)  CONFIGURE=1; shift ;;
    --from-image) MODE=image; shift ;;
    --from-build) MODE=build; shift ;;
    --keep-dir)   KEEP_DIR=1; shift ;;
    --fresh-project) FRESH_PROJECT=1; shift ;;
    --previous-dist) PREVIOUS_DIST=${2:?}; shift 2 ;;
    -h|--help)    awk 'NR==1{next} /^set -e/{exit} {sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *)            die "unknown option: $1 (see --help)" ;;
  esac
done
[[ $FRESH_PROJECT -eq 0 || -z $PREVIOUS_DIST ]] || die "choose --fresh-project or --previous-dist, not both"

# ---------------------------------------------------- configuration ---------
CONFIG_FILE=deploy.conf
INTERACTIVE=0
[[ -t 0 ]] && INTERACTIVE=1

load_config() { # KEY=VALUE file; real environment variables keep precedence
  [[ -f $CONFIG_FILE ]] || return 0
  local line key val
  while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}; val=${line#*=}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n ${!key+x} ]] || export "$key=$val"
  done < "$CONFIG_FILE"
}
load_config

# ---- host/target detection (before the defaults: the project default and
# questionnaire hints depend on the target). Laptop/CI hosts without .env
# fall through to the container-build path. -----------------------------------
STORE_HOST=0
MON_HOST=0
if command -v docker >/dev/null 2>&1 && [[ -f .env ]]; then
  [[ -n $(docker compose --profile app ps -q store 2>/dev/null || true) ]] && STORE_HOST=1
  [[ -n $(docker compose -f docker-compose.monitor.yml ps -q monitor 2>/dev/null || true) ]] && MON_HOST=1
fi
if [[ $TARGET == auto ]]; then
  TARGET=store
  if [[ $MON_HOST -eq 1 && $STORE_HOST -eq 0 ]]; then
    TARGET=monitor
    log "monitor host detected — targeting the monitor SPA"
  fi
fi
MON_BASE=docker-compose.monitor.yml
MON_BUILD_OV=docker-compose.monitor-build.override.yml
if [[ $TARGET == monitor ]]; then
  MON_COMPOSE=(-f "$MON_BASE")
  [[ -f .monitor-release.yml ]] && MON_COMPOSE+=(-f .monitor-release.yml)
fi

# flag > environment > deploy.conf > built-in default
BASE_URL=${BASE_URL:-${ASSETS_BASE_URL:-}}
PROJECT_DEFAULTED=0
if [[ -z $PROJECT ]]; then
  PROJECT=${ASSETS_PAGES_PROJECT:-}
  [[ -n $PROJECT ]] || PROJECT_DEFAULTED=1
fi
resolve_project() {
  if [[ $PROJECT_DEFAULTED -eq 1 ]]; then
    if [[ $TARGET == monitor && -n $BASE_URL && ${BASE_URL%/} != */monitor ]]; then
      PROJECT=infinia-monitor-assets
    else
      PROJECT=infinia-assets
    fi
  fi
}
resolve_project
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}
# Index location inside the publish dir ('monitor/index.html' for staged publishes).
INDEX_HTML=index.html

# Target-host last resort: the running deployment's .env already names the
# origin (kept there by the image mode below / upgrade.sh's re-publish).
if [[ -z ${ASSETS_BASE_URL:-} && -f .env ]]; then
  ASSETS_BASE_URL=$(grep -E '^ASSETS_BASE_URL=' .env | head -1 | cut -d= -f2- || true)
  BASE_URL=${BASE_URL:-${ASSETS_BASE_URL:-}}
fi

ask() { # ask <prompt> [default] — answer in REPLY (stdin-friendly)
  local prompt=$1 def=${2:-}
  if [[ $INTERACTIVE -eq 1 ]]; then
    if [[ -n $def ]]; then
      read -r -e -p "$prompt [$def]: " REPLY || die "no input available — pre-provision via '$0 --configure' with piped answers"
      REPLY=${REPLY:-$def}
    else
      read -r -e -p "$prompt: " REPLY || die "no input available — pre-provision via '$0 --configure' with piped answers"
    fi
  else
    if [[ -n $def ]]; then
      read -r -p "$prompt [$def]: " REPLY || die "no input available"
      REPLY=${REPLY:-$def}
    else
      read -r -p "$prompt: " REPLY || die "no input available"
    fi
  fi
}

ask_secret() { # hidden on a terminal, plain on a pipe
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -s -p "$1: " REPLY || die "no input available"
  else
    read -r -p "$1: " REPLY || die "no input available"
  fi
  printf '\n' >&2
}

upsert_conf() { # upsert_conf <key> <value> — into deploy.conf
  local key=$1 val=$2
  if [[ -f $CONFIG_FILE ]] && grep -q "^${key}=" "$CONFIG_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$val" >> "$CONFIG_FILE"
  fi
}

configure_assets() { # configure_assets <need-base-url 0|1> — fill + optionally save
  local need_base=$1 def_sub
  # Shared-domain style by default: one project/domain, monitor under /monitor.
  if [[ $TARGET == monitor ]]; then def_sub=asset.example.com/monitor; else def_sub=asset.example.com; fi
  log "configuration — missing values (answers can be saved to $CONFIG_FILE)"
  if [[ $need_base -eq 1 && -z $BASE_URL ]]; then
    while :; do
      ask "Assets origin URL (absolute https://, e.g. https://$def_sub)" "https://$def_sub"
      if [[ $REPLY == https://* ]]; then BASE_URL=$REPLY; export ASSETS_BASE_URL=$REPLY; break; fi
      warn "must start with https://"
    done
  fi
  if [[ -z ${CLOUDFLARE_ACCOUNT_ID:-} ]]; then
    ask "Cloudflare Account ID (dashboard: Workers & Pages → right sidebar)"
    [[ -n $REPLY ]] || die "account id is required"
    export CLOUDFLARE_ACCOUNT_ID=$REPLY
  fi
  if [[ -z ${CLOUDFLARE_API_TOKEN:-} ]]; then
    ask_secret "Cloudflare API token (permission: Cloudflare Pages · Edit)"
    [[ -n $REPLY ]] || die "API token is required"
    export CLOUDFLARE_API_TOKEN=$REPLY
  fi
  resolve_project
  ask "Save these settings to $CONFIG_FILE for future runs" "Y"
  if [[ $REPLY == [Yy]* ]]; then
    upsert_conf ASSETS_BASE_URL "$BASE_URL"
    upsert_conf ASSETS_PAGES_PROJECT "$PROJECT"
    upsert_conf CLOUDFLARE_ACCOUNT_ID "$CLOUDFLARE_ACCOUNT_ID"
    upsert_conf CLOUDFLARE_API_TOKEN "$CLOUDFLARE_API_TOKEN"
    chmod 600 "$CONFIG_FILE"
    log "saved to $CONFIG_FILE (mode 600, gitignored — it holds the token)"
  else
    log "not saving — values apply to this run only"
  fi
}

# Required values: publish-only mode needs the Cloudflare pair; full runs also
# need the assets origin. Missing + terminal (or --configure) → questionnaire;
# missing + unattended → fail fast with the configuration hints.
NEED_BASE_URL=1
[[ -n $DIST_ARG ]] && NEED_BASE_URL=0
MISSING=()
[[ -z ${CLOUDFLARE_API_TOKEN:-} ]] && MISSING+=('CLOUDFLARE_API_TOKEN')
[[ -z ${CLOUDFLARE_ACCOUNT_ID:-} ]] && MISSING+=('CLOUDFLARE_ACCOUNT_ID')
[[ $NEED_BASE_URL -eq 1 && -z $BASE_URL ]] && MISSING+=('ASSETS_BASE_URL')
if [[ ${#MISSING[@]} -gt 0 || $CONFIGURE -eq 1 ]]; then
  if [[ $INTERACTIVE -eq 1 || $CONFIGURE -eq 1 ]]; then
    configure_assets "$NEED_BASE_URL"
    BASE_URL=${BASE_URL:-${ASSETS_BASE_URL:-}}
  else
    die "missing configuration: ${MISSING[*]}
  fix one of three ways — flag (--base-url/--project), environment variable,
  or a $CONFIG_FILE file; '$0 --configure' runs an interactive questionnaire"
  fi
fi
if [[ $CONFIGURE -eq 1 ]]; then
  log "configuration complete — rerun without --configure to publish"
  exit 0
fi
resolve_project
[[ $PROJECT =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ || $PROJECT =~ ^[a-z0-9]$ ]] || die "invalid Pages project name"
export PAGES_INIT=${PAGES_INIT:-1} ASSETS_PAGES_PROJECT=$PROJECT

# wrangler without a host Node toolchain: prefer local npx, else run it in a
# throwaway node container (the Docker-only deploy hosts).
wrangler_create() { # create the Pages project if absent
  if command -v npx >/dev/null; then
    npx --yes wrangler@4 pages project create "$PROJECT" --production-branch=main
  else
    command -v docker >/dev/null || die "wrangler needs npx or docker on the host"
    docker run --rm \
      -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID -e NPM_CONFIG_REGISTRY \
      "$NODE_IMAGE" npx --yes wrangler@4 pages project create "$PROJECT" --production-branch=main
  fi
}

wrangler_deploy() { # wrangler_deploy <dist-abs> — publish the directory
  local dist=$1
  if command -v npx >/dev/null; then
    npx --yes wrangler@4 pages deploy --project-name="$PROJECT" --branch=main \
      --commit-dirty=true "$dist"
  else
    command -v docker >/dev/null || die "wrangler needs npx or docker on the host"
    # Writable mount: wrangler stages upload state under <dir>/.wrangler — a
    # read-only bind failed with "Missing file or directory: /dist/.wrangler/tmp".
    docker run --rm -v "$dist:/dist" -w /dist \
      -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID -e NPM_CONFIG_REGISTRY \
      "$NODE_IMAGE" npx --yes wrangler@4 pages deploy \
      --project-name="$PROJECT" --branch=main --commit-dirty=true /dist
  fi
  # A containerized wrangler leaves .wrangler root-owned; without the
  # fallback set -e aborts the script AFTER a successful publish.
  rm -rf "$dist/.wrangler" 2>/dev/null ||
    docker run --rm -v "$dist:/dist" "$NODE_IMAGE" sh -c 'rm -rf /dist/.wrangler'
}

# Publish a built dist (dist layout at its root) to the Pages project.
publish_dist() { # publish_dist <dist-dir> — index per $INDEX_HTML
  local dist=$1
  test -f "$dist/$INDEX_HTML" || { echo "error: $dist/$INDEX_HTML not found — build first" >&2; return 1; }
  local dist_abs
  dist_abs=$(cd "$dist" && pwd)

  # Visibility check: which base mode is this dist carrying?
  if grep -q 'src="https://[^"]*/assets/' "$dist_abs/$INDEX_HTML"; then
    log "dist uses an absolute assets origin (matches a server built with ASSETS_BASE_URL set)"
  else
    log "NOTE: dist references same-origin /assets/* — if the server runs with ASSETS_BASE_URL set, rebuild with the same value before publishing"
  fi

  if [[ ${PAGES_INIT:-} == 1 ]]; then
    log "creating Pages project $PROJECT (production branch main) if absent"
    local create_output
    if ! create_output=$(wrangler_create 2>&1); then
      if ! printf '%s' "$create_output" | grep -qi 'already exists'; then
        printf '%s\n' "$create_output" >&2
        die "Pages project creation failed"
      fi
    fi
  fi

  log "publishing $dist_abs to Pages project $PROJECT (branch main)"
  wrangler_deploy "$dist_abs"
}

# ---- publish-only mode: --dist <dir> ----------------------------------------
if [[ -n $DIST_ARG ]]; then
  [[ -z $BASE_URL ]] || warn "--base-url ignored in --dist mode (dist is already built)"
  [[ $FRESH_PROJECT -eq 0 && -z $PREVIOUS_DIST ]] || die "--dist already supplies the complete Pages tree; do not combine it with retention options"
  [[ $SWITCH -eq 0 && $WAIT_ASSETS -eq 0 ]] || die "--switch/--all/--wait-assets do not combine with --dist"
  # --dist is a COMPLETE project snapshot, so enumerate its full tree without
  # inferring a target prefix or trying to merge an unrelated origin.
  DIST_ARG=$(cd "$DIST_ARG" && pwd)
  if command -v node >/dev/null; then
    node scripts/pages-assets.mjs "$DIST_ARG" "" 1
  else
    command -v docker >/dev/null || die "manifest generation needs node or docker"
    docker run --rm -v "$PWD/scripts:/scripts:ro" -v "$DIST_ARG:/dist" \
      "$NODE_IMAGE" node /scripts/pages-assets.mjs /dist "" 1
  fi
  [[ -f "$DIST_ARG/index.html" ]] || INDEX_HTML=monitor/index.html
  publish_dist "$DIST_ARG"
  log "done. One-time wiring if not yet done: bind the custom domain"
  log "for $PROJECT in the Pages project settings."
  exit 0
fi

# ---- full mode: resolve inputs ----------------------------------------------
BASE_URL=${BASE_URL%/}   # stored/probed without the trailing slash
[[ -n $BASE_URL ]] || die "--base-url (or ASSETS_BASE_URL) is required, e.g. --base-url https://assets.infinia.fyi"
[[ $BASE_URL =~ ^https://[A-Za-z0-9.-]+(/monitor)?$ ]] || die "--base-url must be https://HOST (dedicated) or https://HOST/monitor (shared monitor)"
[[ $TARGET == monitor || $BASE_URL != */monitor ]] || die "the store assets must use the domain root"
ASSET_REL=.
[[ $BASE_URL != */monitor ]] || ASSET_REL=monitor
# Export the resolved value: compose shell variables override .env.
export ASSETS_BASE_URL=$BASE_URL
command -v docker >/dev/null || die "docker is required"

# ---- pick the mode ----------------------------------------------------------
if [[ $MODE == auto ]]; then
  if [[ $TARGET == monitor ]]; then
    [[ $MON_HOST -eq 1 ]] && MODE=image || MODE=build
  else
    [[ $STORE_HOST -eq 1 ]] && MODE=image || MODE=build
  fi
fi
if [[ $SWITCH -eq 1 && $MODE != image ]]; then
  if [[ $ALL -eq 1 ]]; then
    warn "--all on a non-$TARGET host: publishing and domain attach only —"
    warn "finish by running the same command on the $TARGET host"
    SWITCH=0
  else
    die "--switch only applies on the $TARGET host (image mode)"
  fi
fi

TMPDIST=$(mktemp -d "${TMPDIR:-/tmp}/infinia-assets.XXXXXX")
cleanup() { [[ $KEEP_DIR -eq 1 ]] && log "keeping $TMPDIST (--keep-dir)" || rm -rf "$TMPDIST"; }
trap cleanup EXIT

# Extract the SPA out of a built image's jar into $2 (dist layout at its root).
extract_jar_static() {
  local jar=$1 dest=$2
  if command -v unzip >/dev/null; then
    unzip -q "$jar" 'BOOT-INF/classes/static/*' -d "$dest"
    cp -R "$dest/BOOT-INF/classes/static/." "$dest/"
    rm -rf "$dest/BOOT-INF"
  else
    python3 - "$jar" "$dest" <<'PY'
import sys, zipfile, os, shutil
jar, dest = sys.argv[1], sys.argv[2]
prefix = 'BOOT-INF/classes/static/'
with zipfile.ZipFile(jar) as z:
    for n in z.namelist():
        if n.startswith(prefix) and not n.endswith('/'):
            z.extract(n, dest)
src = os.path.join(dest, 'BOOT-INF/classes/static')
for e in os.listdir(src):
    shutil.move(os.path.join(src, e), os.path.join(dest, e))
PY
    rm -rf "$dest/BOOT-INF"
  fi
}

# Root _headers for a staged (shared-domain) publish: Pages reads only the
# deployment ROOT _headers, so a subtree-only deployment must still carry the
# CORS rules for BOTH SPAs — keep in sync with store-web/public/_headers.
write_shared_headers() { # write_shared_headers <stage-dir>
  cat > "$1/_headers" <<'HEADERS'
/assets/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
/monitor/assets/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
HEADERS
}

# Build a complete publish tree, retaining both SPAs and previous hashed files.
# Node is available locally or in the same container used by the build.
retain_assets() { # retain_assets <stage-dir>
  local stage=$1 origin=${BASE_URL%/monitor}
  local previous_args=()
  if [[ -n $PREVIOUS_DIST ]]; then
    PREVIOUS_DIST=$(cd "$PREVIOUS_DIST" && pwd)
    previous_args=(-v "$PREVIOUS_DIST:/previous:ro")
  fi
  if command -v node >/dev/null; then
    node scripts/pages-assets.mjs "$stage" "$origin" "$FRESH_PROJECT" "$PREVIOUS_DIST"
  else
    docker run --rm -v "$PWD/scripts:/scripts:ro" -v "$stage:/stage" "${previous_args[@]}" \
      "$NODE_IMAGE" node /scripts/pages-assets.mjs /stage "$origin" "$FRESH_PROJECT" "${PREVIOUS_DIST:+/previous}"
  fi
}

if [[ $MODE == image && $TARGET == monitor ]]; then
  # ---- monitor host: publish exactly what the next jar embeds --------------
  log "monitor host: upserting ASSETS_BASE_URL=$BASE_URL in .env"
  if [[ ${DEPLOY_ASSETS_HOOK:-} == 1 ]]; then
    : # The upgrade supplies the exact baked-in origin.
  elif grep -q '^ASSETS_BASE_URL=' .env; then
    sed -i.bak "s|^ASSETS_BASE_URL=.*|ASSETS_BASE_URL=$BASE_URL|" .env && rm -f .env.bak
  else
    printf '\nASSETS_BASE_URL=%s\n' "$BASE_URL" >> .env
  fi
  if [[ -n ${DEPLOY_ASSETS_IMAGE:-} ]]; then
    IMG=$DEPLOY_ASSETS_IMAGE
  elif [[ ${DEPLOY_ASSETS_HOOK:-} == 1 ]]; then
    # Retry: publish the running image without rebuilding different bytes.
    CID=$(docker compose "${MON_COMPOSE[@]}" ps -q monitor)
    [[ -n $CID ]] || die "no running monitor container to extract from"
    IMG=$(docker inspect -f '{{.Image}}' "$CID")
  else
    log "building the next monitor image (the running container keeps serving)"
    cat > "$MON_BUILD_OV" <<'OVERRIDE'
services:
  monitor:
    image: infinia-monitor-assets:latest
    build:
      context: .
      dockerfile: Dockerfile.monitor
      args:
        # Interpolated from this host's .env — same origin the publish uses.
        ASSETS_BASE_URL: ${ASSETS_BASE_URL:-}
OVERRIDE
    docker compose -f "$MON_BASE" -f "$MON_BUILD_OV" build monitor
    IMG=$(docker image inspect -f '{{.Id}}' infinia-monitor-assets:latest)
  fi
  log "extracting the monitor SPA from the image's jar"
  docker create --name mon-extract-$$ "$IMG" >/dev/null
  trap 'docker rm -f mon-extract-$$ >/dev/null 2>&1 || true; cleanup' EXIT
  docker cp mon-extract-$$:/app/store-monitor.jar "$TMPDIST/web.jar"
  docker rm mon-extract-$$ >/dev/null
  # Stage at /monitor for a shared origin, or at / for a dedicated origin.
  mkdir -p "$TMPDIST/extract" "$TMPDIST/stage/$ASSET_REL"
  extract_jar_static "$TMPDIST/web.jar" "$TMPDIST/extract"
  rm -f "$TMPDIST/web.jar"
  cp -R "$TMPDIST/extract/." "$TMPDIST/stage/$ASSET_REL/"
  write_shared_headers "$TMPDIST/stage"
  DIST=$TMPDIST/stage
  INDEX_HTML=$ASSET_REL/index.html
elif [[ $MODE == image ]]; then
  # ---- store host: publish exactly what the next jar embeds ----------------
  log "store host: upserting ASSETS_BASE_URL=$BASE_URL in .env"
  if [[ ${DEPLOY_ASSETS_HOOK:-} == 1 ]]; then
    : # The upgrade supplies the exact baked-in origin.
  elif grep -q '^ASSETS_BASE_URL=' .env; then
    sed -i.bak "s|^ASSETS_BASE_URL=.*|ASSETS_BASE_URL=$BASE_URL|" .env && rm -f .env.bak
  else
    printf '\nASSETS_BASE_URL=%s\n' "$BASE_URL" >> .env
  fi

  if [[ -n ${DEPLOY_ASSETS_IMAGE:-} ]]; then
    IMG=$DEPLOY_ASSETS_IMAGE
  elif [[ ${DEPLOY_ASSETS_HOOK:-} == 1 ]]; then
    CID=$(docker compose --profile app ps -q store)
    [[ -n $CID ]] || die "no running store container to extract from"
    IMG=$(docker inspect -f '{{.Image}}' "$CID")
  else
    log "building the next image (the running container keeps serving)"
    docker compose --profile app build store
    IMG=infinia-webservice
  fi

  log "extracting the SPA from the image's jar"
  docker create --name web-extract-$$ "$IMG" >/dev/null
  trap 'docker rm -f web-extract-$$ >/dev/null 2>&1 || true; cleanup' EXIT
  docker cp web-extract-$$:/app/InfiniaWebService.jar "$TMPDIST/web.jar"
  docker rm web-extract-$$ >/dev/null
  mkdir -p "$TMPDIST/stage"
  extract_jar_static "$TMPDIST/web.jar" "$TMPDIST/stage"
  rm -f "$TMPDIST/web.jar"
  DIST=$TMPDIST/stage
else
  # ---- any host: build in a node container from the same lockfile ----------
  if [[ $TARGET == monitor ]]; then
    WORKSPACE=@infinia/monitor-web
    DISTDIR=monitor-web/dist
  else
    WORKSPACE=@infinia/store-web
    DISTDIR=store-web/dist
  fi
  log "building $WORKSPACE in a $NODE_IMAGE container (same lockfile, same base URL)"
  warn "this creates node_modules/ inside the repo checkout (gitignored)"
  docker run --rm \
    -v "$PWD":/ws -w /ws \
    -e ASSETS_BASE_URL="$BASE_URL" \
    -e NPM_CONFIG_REGISTRY -e COREPACK_NPM_REGISTRY \
    "$NODE_IMAGE" sh -c \
      "corepack enable && yarn install --immutable && yarn workspace $WORKSPACE build"
  DIST=$TMPDIST/stage
  mkdir -p "$DIST/$ASSET_REL"
  cp -R "$PWD/$DISTDIR/." "$DIST/$ASSET_REL/"
  INDEX_HTML=$ASSET_REL/index.html
fi

test -f "$DIST/$INDEX_HTML" || die "no $INDEX_HTML under $DIST — build failed?"
# Capture this build's entry before retention adds older index-*.js files.
ENTRY=$(grep -oE 'src="[^"]*/assets/index-[^"/]+\.js"' "$DIST/$INDEX_HTML" | head -1)
ENTRY=${ENTRY##*/}; ENTRY=${ENTRY%\"}
[[ -n $ENTRY ]] || die "entry script not found in $INDEX_HTML"
grep -Fq "src=\"$BASE_URL/assets/$ENTRY\"" "$DIST/$INDEX_HTML" || die "image/dist was built with a different ASSETS_BASE_URL; refusing to publish mismatched assets"
PROBE_URL="$BASE_URL/assets/$ENTRY"
retain_assets "$DIST"
write_shared_headers "$DIST"
publish_dist "$DIST"

# ---- domain: attach via API, then wait until it actually serves ------------
DOMAIN=${BASE_URL#https://}; DOMAIN=${DOMAIN%%/*}

attach_domain() { # attach $DOMAIN to the Pages project — idempotent
  log "attaching custom domain $DOMAIN to Pages project $PROJECT"
  local status body
  status=$(curl -sS -o "$TMPDIST/pages-domain.json" -w '%{http_code}' -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' --data "{\"name\":\"$DOMAIN\"}")
  body=$(cat "$TMPDIST/pages-domain.json" 2>/dev/null || true)
  if [[ $status == 2* ]] && printf '%s' "$body" | grep -q '"success":[[:space:]]*true'; then
    log "domain attached — verify its CNAME/DNS configuration in Cloudflare"
  elif printf '%s' "$body" | grep -qiE 'already (exists|attached)|already.*this project'; then
    log "domain already attached"
  else
    warn "domain attach returned HTTP $status — if the zone lives on another Cloudflare account,"
    warn "bind $DOMAIN in the Pages project settings (dashboard) instead"
  fi
}
[[ $DOMAIN == "$PROJECT.pages.dev" ]] || attach_domain

probe_asset() {
  # A Pages SPA fallback can return HTTP 200 HTML for a missing .js file.
  # Compare bytes, so an old bundle or fallback cannot trigger a cutover.
  curl -fsS --max-time 20 "$PROBE_URL" -o "$TMPDIST/probe.js" 2>/dev/null &&
    cmp -s "$TMPDIST/probe.js" "$DIST/$ASSET_REL/assets/$ENTRY"
}

wait_for_domain() { # 0 once $PROBE_URL serves; ~10 min of retries
  local tries=40 i=1
  until probe_asset; do
    if [[ $i -ge $tries ]]; then return 1; fi
    [[ $((i % 4)) -eq 1 ]] && log "waiting for the domain to serve the assets (DNS/cert provisioning, up to ~10 min) — attempt $i/$tries"
    sleep 15
    i=$((i + 1))
  done
  return 0
}

if [[ $SWITCH -eq 1 || $WAIT_ASSETS -eq 1 ]]; then
  log "waiting for $PROBE_URL"
  if ! wait_for_domain; then
    cat <<NOTICE

Domain still not serving after ~10 min — DNS/cert provisioning is unusually
slow; NOT switching. Check Workers & Pages → $PROJECT → Custom domains in
the dashboard, then re-run: scripts/deploy-assets.sh --switch
NOTICE
    exit 1
  fi
  log "domain is serving the published assets"
  [[ $SWITCH -eq 1 ]] || exit 0
  if [[ $TARGET == monitor ]]; then
    log "switching the monitor to the new image"
    MC=(-f "$MON_BASE")
    [[ -f $MON_BUILD_OV ]] && MC+=(-f "$MON_BUILD_OV")
    # Keep future upgrades/retries on the same image selected for publication.
    printf 'services:\n  monitor:\n    image: "%s"\n' "$IMG" > .monitor-release.yml
    MC+=(-f .monitor-release.yml)
    docker compose "${MC[@]}" up -d --no-build --pull never
    HEALTH_URL=http://127.0.0.1:8090/actuator/health
    WHAT=monitor
  else
    log "switching the store to the new image"
    docker compose --profile app up -d --no-build --pull never
    HEALTH_URL=http://127.0.0.1:8080/actuator/health
    WHAT=store
  fi
  log "waiting for $WHAT to report healthy (best effort)"
  ok=0
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"UP"'; then ok=1; break; fi
    sleep 5
  done
  [[ $ok -eq 1 ]] && log "$WHAT is healthy — hard-refresh and verify assets load from $BASE_URL" \
                   || warn "$WHAT did not report UP within 300s — check: docker compose ps && docker compose logs --tail 50 $WHAT"
else
  if probe_asset; then
    log "domain is already serving the published assets"
  else
    log "domain provisioning started — DNS/cert usually take a few minutes"
  fi
  # upgrade.sh handles its own cutover after the asset verification succeeds.
  if [[ ${DEPLOY_ASSETS_HOOK:-} != 1 ]]; then
    cat <<NEXT

Assets published to Pages. To cut the $TARGET over (its host):
  scripts/deploy-assets.sh $([[ $TARGET == monitor ]] && printf "%s" "--monitor") --switch
NEXT
  fi
fi
