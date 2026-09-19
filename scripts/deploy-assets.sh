#!/usr/bin/env bash
#
# One-click Cloudflare Pages bootstrap/publish for the hashed static assets of
# the store SPA and the monitor SPA (DEPLOYMENT.md "Static assets on
# Cloudflare Pages" — the first-visit 522 fix). One script, two targets:
#
#   store (default)     — store-web SPA, assets domain e.g. assets.example.com,
#                         Pages project infinia-assets
#   monitor (--monitor) — monitor-web SPA (split deployment's monitor host),
#                         in whichever layout its ASSETS_BASE_URL names: a
#                         bare domain (https://status-assets.example.com)
#                         publishes the dist at the ROOT of the monitor's OWN
#                         Pages project/domain; a domain with a path
#                         (https://asset.example.com/monitor) stages it as the
#                         /monitor subtree of the STORE's shared project and
#                         mirrors the store's half in (mirror_shared_half).
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
#   --dist DIR         publish this already-built dist and exit (no build,
#                      no .env changes, no --switch)
#   --project NAME     Pages project (default infinia-assets, or
#                      infinia-monitor-assets with --monitor)
#   --switch           after publishing, recreate the target's container with
#                      the new image — only once the domain serves the files
#   --configure        run the interactive questionnaire, save deploy.conf, exit
#   --from-image       force the host path (extract from built image)
#   --from-build       force the container-build path (any host)
#   --keep-dir         keep the temporary publish directory (debugging)
#
# Idempotent: re-running rebuilds (layer-cached), re-extracts and re-publishes
# additively — hashed files accumulate, so older shells keep resolving.
# upgrade.sh re-publishes automatically after every successful deploy while
# the offload is active (ASSETS_BASE_URL in .env + deploy.conf present).
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
KEEP_DIR=0
CONFIGURE=0
ALL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url)   BASE_URL=${2:?}; shift 2 ;;
    --dist)       DIST_ARG=${2:?}; shift 2 ;;
    --project)    PROJECT=${2:?}; shift 2 ;;
    --switch)     SWITCH=1; shift ;;
    --all)        ALL=1; SWITCH=1; shift ;;
    --monitor)    TARGET=monitor; shift ;;
    --configure)  CONFIGURE=1; shift ;;
    --from-image) MODE=image; shift ;;
    --from-build) MODE=build; shift ;;
    --keep-dir)   KEEP_DIR=1; shift ;;
    -h|--help)    awk 'NR==1{next} /^set -e/{exit} {sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *)            die "unknown option: $1 (see --help)" ;;
  esac
done

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
  docker compose --profile app config --services 2>/dev/null | grep -qx store && STORE_HOST=1
  docker compose -f docker-compose.monitor.yml config --services 2>/dev/null | grep -qx monitor && MON_HOST=1
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
if [[ $TARGET == monitor && $MON_HOST -eq 1 ]]; then
  MON_COMPOSE=(-f "$MON_BASE")
  [[ -f .monitor-release.yml ]] && MON_COMPOSE+=(-f .monitor-release.yml)
fi

# flag > environment > deploy.conf > built-in default
BASE_URL=${BASE_URL:-${ASSETS_BASE_URL:-}}
if [[ -z $PROJECT ]]; then
  if [[ $TARGET == monitor ]]; then
    PROJECT=${ASSETS_PAGES_PROJECT:-infinia-monitor-assets}
  else
    PROJECT=${ASSETS_PAGES_PROJECT:-infinia-assets}
  fi
fi
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}
# Index location inside the publish dir ("monitor/index.html" for shared-subtree
# monitor publishes; root layouts keep the default).
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
  if [[ $need_base -eq 1 && -z ${ASSETS_BASE_URL:-} ]]; then
    while :; do
      ask "Assets origin URL (absolute https://, e.g. https://$def_sub.example.com)" "https://$def_sub.example.com"
      if [[ $REPLY == https://* ]]; then export ASSETS_BASE_URL=$REPLY; break; fi
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
  ask "Save these settings to $CONFIG_FILE for future runs" "Y"
  if [[ $REPLY == [Yy]* ]]; then
    upsert_conf ASSETS_BASE_URL "${ASSETS_BASE_URL:-}"
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
[[ $NEED_BASE_URL -eq 1 && -z ${ASSETS_BASE_URL:-} ]] && MISSING+=('ASSETS_BASE_URL')
if [[ ${#MISSING[@]} -gt 0 ]]; then
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
  rm -rf "$dist/.wrangler"
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
    # "already exists" is success for the idempotent one-time path.
    wrangler_create || log "project create reported an error (usually: already exists) — continuing"
  fi

  log "publishing $dist_abs to Pages project $PROJECT (branch main)"
  wrangler_deploy "$dist_abs"
}

# ---- publish-only mode: --dist <dir> ----------------------------------------
if [[ -n $DIST_ARG ]]; then
  [[ -z $BASE_URL ]] || warn "--base-url ignored in --dist mode (dist is already built)"
  [[ $SWITCH -eq 0 ]] || die "--switch/--all do not combine with --dist"
  publish_dist "$DIST_ARG"
  log "done. One-time wiring if not yet done: bind the custom domain"
  log "for $PROJECT in the Pages project settings."
  exit 0
fi

# ---- full mode: resolve inputs ----------------------------------------------
BASE_URL=${BASE_URL%/}   # stored/probed without the trailing slash
[[ -n $BASE_URL ]] || die "--base-url (or ASSETS_BASE_URL) is required, e.g. --base-url https://assets.infinia.fyi"
[[ $BASE_URL == http* ]] || die "--base-url must be an absolute https:// URL"
command -v docker >/dev/null || die "docker is required"

# Monitor publish layout, from the base URL's shape: a bare domain means the
# monitor's OWN Pages project published at its root (dedicated layout — no
# subtree staging, no mirror); a domain with a /monitor path means the store's
# shared project with the monitor staged under that subtree (shared layout).
MON_SUBTREE=monitor
SHARED_MONITOR=0
if [[ $TARGET == monitor ]]; then
  case "${BASE_URL#https://*}" in
    */$MON_SUBTREE) SHARED_MONITOR=1 ;;
    */?*) die "unsupported path in --base-url $BASE_URL — shared publishes stage only under /$MON_SUBTREE; use a bare domain for the monitor's own project" ;;
  esac
fi

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
    (cd "$dest" && unzip -q "$jar" 'BOOT-INF/classes/static/*' \
      && mv BOOT-INF/classes/static/* . \
      && rmdir BOOT-INF/classes/static BOOT-INF/classes BOOT-INF 2>/dev/null || true)
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

# A Pages deployment REPLACES the whole project tree, but a shared project
# carries both SPAs (store at the root, monitor under /monitor): publishing
# one side's subtree alone drops the other side's hashed files from the
# production domain (verified the hard way — a monitor-only publish 404'd the
# store's bundle). So mirror the other half from the live domain into this
# publish: the files are content-hashed and immutable, a verbatim copy is
# exactly what that side's own publish uploaded.
#
# Pages' SPA fallback makes a MISSING half look like HTTP 200 HTML, so the
# fetched shell is validated against that half's real asset URLs before
# anything is copied. A masked or absent monitor half (it moved to its own
# assets domain, or an older publish dropped it) downgrades to a warning and
# the store still publishes; an absent store half is fatal, because a
# monitor-only publish would drop the live store. Once a half is confirmed
# live, a failure to copy any of its files aborts the publish (fail closed).
# Dedicated-domain publishes never call this — there is no other half.
mirror_shared_half() { # mirror_shared_half <stage-dir> <own-target: monitor|store>
  local stage=$1 own=$2 domain other expect shell
  domain=${BASE_URL#https://}; domain=${domain%%/*}
  if [[ $own == monitor ]]; then
    other="https://$domain"                         # the store half lives at the root
    expect="https://$domain/assets/"                # every real store shell references these
  else
    other="https://$domain/$MON_SUBTREE"            # the monitor half lives under the subtree
    expect="https://$domain/$MON_SUBTREE/assets/"   # every real monitor shell references these
  fi
  if ! shell=$(curl -fsSL --max-time 30 "$other/" 2>/dev/null); then
    if [[ $own == monitor ]]; then
      die "the store half is not serving at $other/ — a monitor-only publish would drop it
  from the shared project. Run the store-side publish first (store host: scripts/deploy-assets.sh),
  or bypass the mirror with --dist if you truly intend a monitor-only tree"
    fi
    warn "shared-domain mirror: the other half is not serving at $other/ — publishing without it"
    warn "(first-time setup, or that side moved to its own assets domain)"
    return 0
  fi
  if ! grep -qF "$expect" <<<"$shell"; then
    if [[ $own == monitor ]]; then
      die "no store SPA shell at $other/ (nothing references $expect — the Pages SPA fallback
  is masking something). A monitor-only publish would drop the live store half; investigate
  the domain before publishing, or bypass the mirror with --dist"
    fi
    warn "shared-domain mirror: no monitor SPA live at $other/ — the Pages SPA fallback answered."
    warn "Publishing the store half only. Expected once the monitor serves from its own assets"
    warn "domain; if it should live here, its half was dropped earlier — restore it with a"
    warn "monitor-side publish against this same shared base URL"
    return 0
  fi
  log "shared-domain mirror: copying the other SPA's files from $other into this publish"
  # Worklist of "<url> <fatal>" lines. Shell-referenced files are fatal on
  # failure; files discovered one hop deeper are not — hashed SPAs lazy-load
  # route chunks via RELATIVE imports ("./View-x.js") that never appear in the
  # shell (the store splits into dozens), but a quoted string in minified code
  # can look like a path without being one, so those only warn+skip on 404.
  local work="" queued=$'\n' line url fatal ref dest ctype dir rel r2 copied=0 skipped=0 tally=""
  # queued: every ref ever added to the worklist — each enters at most once,
  # so the pop side needs no dedup check of its own.
  while read -r url; do
    ref=${url#https://$domain}
    [[ $ref == /_headers ]] && continue
    grep -qxF "$ref" <<<"$queued" && continue
    queued+="$ref"$'\n'
    work+="$url 1"$'\n'
  done < <(printf '%s\n' "$shell" | grep -oE "https://$domain/[A-Za-z0-9._/-]+" | sort -u)
  local guard=0
  while [[ -n $work ]]; do
    line=${work%%$'\n'*}
    if [[ $work == *$'\n'* ]]; then work=${work#*$'\n'}; else work=""; fi
    url=${line% *}; fatal=${line##* }
    ref=${url#https://$domain}
    dest="$stage$ref"
    mkdir -p "$(dirname "$dest")"
    guard=$((guard + 1)); [[ $guard -gt 1000 ]] && die "mirror: runaway worklist (>1000 files) at $url"
    if ! ctype=$(curl -fsSL --max-time 30 -o "$dest" -w '%{content_type}' "$url"); then
      if [[ $fatal == 1 ]]; then
        die "mirror: could not fetch $url — aborting: publishing now would drop the live half at $other"
      fi
      skipped=$((skipped + 1)); warn "mirror: $url not fetchable — skipped (not a real dependency?)"
      rm -f "$dest"; continue
    fi
    if [[ $fatal == 1 ]]; then
      # Strict per-extension guards for shell-referenced files.
      case "$ref" in
        *.js)  [[ $ctype == *javascript* ]] || die "mirror: $url served '$ctype' — aborting: publishing now would drop the live half at $other" ;;
        *.css) [[ $ctype == *css* ]]        || die "mirror: $url served '$ctype' — aborting: publishing now would drop the live half at $other" ;;
        *.svg) [[ $ctype == *svg* || $ctype == *octet-stream* ]] || die "mirror: $url served '$ctype' — aborting: publishing now would drop the live half at $other" ;;
      esac
    elif [[ $ctype == text/html* ]]; then
      # Discovered files only need the fallback-page guard.
      skipped=$((skipped + 1)); warn "mirror: $url served '$ctype' — skipped"
      rm -f "$dest"; continue
    fi
    copied=$((copied + 1))
    case "$ref" in
      *.js|*.css)
        # Chase what this bundle itself loads. Vite emits lazy chunks both as
        # relative imports ("./View-x.js") and as __vite__mapDeps entries
        # ("assets/View-x.js" — where per-route CSS files only ever appear);
        # CSS url(./…) assets resolve like relative imports.
        dir=$(dirname "$ref")
        while read -r rel; do
          case $rel in
            '"./'*)      rel=${rel#'"./'};  rel=${rel%'"'}; r2="$dir/$rel" ;;
            '"assets/'*) rel=${rel#'"'};    rel=${rel%'"'}; r2="/$rel" ;;
            'url(./'*)   rel=${rel#'url(./'}; rel=${rel%')'}; r2="$dir/$rel" ;;
            *) continue ;;
          esac
          [[ -n $rel ]] || continue
          grep -qxF "$r2" <<<"$queued" && continue
          queued+="$r2"$'\n'
          work+="https://$domain$r2 0"$'\n'
        done < <({ grep -oE '"(\./|assets/)[A-Za-z0-9._/-]+"' "$dest" || true
                   grep -oE 'url\(\./[A-Za-z0-9._/?=-]+\)' "$dest" || true; } | sort -u)
        ;;
    esac
  done
  [[ $skipped -gt 0 ]] && tally=" ($skipped discovered ref(s) skipped)"
  log "shared-domain mirror: copied $copied file(s) from $other$tally"
}

if [[ $MODE == image && $TARGET == monitor ]]; then
  # ---- monitor host: publish exactly what the next jar embeds --------------
  log "monitor host: upserting ASSETS_BASE_URL=$BASE_URL in .env"
  if grep -q '^ASSETS_BASE_URL=' .env; then
    sed -i.bak "s|^ASSETS_BASE_URL=.*|ASSETS_BASE_URL=$BASE_URL|" .env && rm -f .env.bak
  else
    printf '\nASSETS_BASE_URL=%s\n' "$BASE_URL" >> .env
  fi
  if [[ ${DEPLOY_ASSETS_HOOK:-} == 1 ]]; then
    # upgrade.sh re-publish: the running image already carries the base.
    CID=$(docker compose "${MON_COMPOSE[@]}" ps -q monitor)
    [[ -n $CID ]] || die "no running monitor container to extract from"
    IMG=$(docker inspect -f '{{.Image}}' "$CID")
  else
    log "building the next monitor image (the running container keeps serving)"
    cat > "$MON_BUILD_OV" <<'OVERRIDE'
services:
  monitor:
    build:
      context: .
      dockerfile: Dockerfile.monitor
      args:
        # Interpolated from this host's .env — same origin the publish uses.
        ASSETS_BASE_URL: ${ASSETS_BASE_URL:-}
OVERRIDE
    docker compose -f "$MON_BASE" -f "$MON_BUILD_OV" build monitor
    MON_REG=$(grep -E '^MONITOR_IMAGE_REGISTRY=' .env | head -1 | cut -d= -f2- || true)
    MON_TAG=$(grep -E '^MONITOR_IMAGE_TAG=' .env | head -1 | cut -d= -f2- || true)
    IMG="${MON_REG:-ghcr.io}/muskstark/infinia-store-platform-monitor:${MON_TAG:-latest}"
  fi
  log "extracting the monitor SPA from the image's jar"
  docker create --name mon-extract-$$ "$IMG" >/dev/null
  trap 'docker rm -f mon-extract-$$ >/dev/null 2>&1 || true; cleanup' EXIT
  docker cp mon-extract-$$:/app/store-monitor.jar "$TMPDIST/web.jar"
  docker rm -f mon-extract-$$ >/dev/null
  mkdir -p "$TMPDIST/extract"
  extract_jar_static "$TMPDIST/web.jar" "$TMPDIST/extract" && rm -f "$TMPDIST/web.jar"
  if [[ $SHARED_MONITOR == 1 ]]; then
    # Shared layout: the monitor SPA lives under /$MON_SUBTREE on the store's
    # Pages project/domain — stage the dist as that subtree, add the shared
    # root _headers, and mirror the store half in.
    mkdir -p "$TMPDIST/stage/$MON_SUBTREE"
    mv "$TMPDIST"/extract/* "$TMPDIST/stage/$MON_SUBTREE/"
    write_shared_headers "$TMPDIST/stage"
    mirror_shared_half "$TMPDIST/stage" monitor
    DIST=$TMPDIST/stage
    INDEX_HTML=$MON_SUBTREE/index.html
  else
    # Dedicated layout: the monitor's own project serves this dist at its
    # root — publish as extracted. The Vite build's own _headers ships in the
    # jar's static root; there is no other half to protect.
    DIST=$TMPDIST/extract
  fi
elif [[ $MODE == image ]]; then
  # ---- store host: publish exactly what the next jar embeds ----------------
  log "store host: upserting ASSETS_BASE_URL=$BASE_URL in .env"
  if grep -q '^ASSETS_BASE_URL=' .env; then
    sed -i.bak "s|^ASSETS_BASE_URL=.*|ASSETS_BASE_URL=$BASE_URL|" .env && rm -f .env.bak
  else
    printf '\nASSETS_BASE_URL=%s\n' "$BASE_URL" >> .env
  fi

  log "building the next image (the running container keeps serving)"
  docker compose --profile app build store

  log "extracting the SPA from the freshly built image's jar"
  docker create --name web-extract-$$ infinia-webservice >/dev/null
  trap 'docker rm -f web-extract-$$ >/dev/null 2>&1 || true; cleanup' EXIT
  docker cp web-extract-$$:/app/InfiniaWebService.jar "$TMPDIST/web.jar"
  docker rm web-extract-$$ >/dev/null
  extract_jar_static "$TMPDIST/web.jar" "$TMPDIST" && rm -f "$TMPDIST/web.jar"
  mirror_shared_half "$TMPDIST" store
  DIST=$TMPDIST
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
  if [[ $TARGET == monitor && $SHARED_MONITOR == 1 ]]; then
    # Same shared-subtree staging as the image path.
    STAGE="$TMPDIST/stage"
    mkdir -p "$STAGE/$MON_SUBTREE"
    cp -R "$PWD/$DISTDIR/." "$STAGE/$MON_SUBTREE/"
    write_shared_headers "$STAGE"
    mirror_shared_half "$STAGE" monitor
    DIST=$STAGE
    INDEX_HTML=$MON_SUBTREE/index.html
  elif [[ $TARGET == monitor ]]; then
    # Dedicated layout: the dist publishes as-is at the project root.
    DIST=$PWD/$DISTDIR
  else
    DIST=$PWD/$DISTDIR
    mirror_shared_half "$DIST" store
  fi
fi

test -f "$DIST/$INDEX_HTML" || die "no $INDEX_HTML under $DIST — build failed?"
publish_dist "$DIST"

# ---- domain: attach via API, then wait until it actually serves ------------
DOMAIN=${BASE_URL#https://}; DOMAIN=${DOMAIN%%/*}
if [[ $TARGET == monitor && $SHARED_MONITOR == 1 ]]; then ASSET_REL=$MON_SUBTREE; else ASSET_REL=.; fi
ENTRY=$(ls "$DIST/$ASSET_REL/assets" | grep -E '^index-[^/]+\.js$' | head -1)
PROBE_URL="$BASE_URL/assets/$ENTRY"

attach_domain() { # attach $DOMAIN to the Pages project — idempotent
  log "attaching custom domain $DOMAIN to Pages project $PROJECT"
  local status body
  status=$(curl -sS -o "$TMPDIST/pages-domain.json" -w '%{http_code}' -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains/$DOMAIN" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' --data '{}')
  body=$(cat "$TMPDIST/pages-domain.json" 2>/dev/null || true)
  if [[ $status == 2* ]] && printf '%s' "$body" | grep -q '"success":[[:space:]]*true'; then
    log "domain attached — DNS record + certificate are provisioned by Cloudflare"
  elif printf '%s' "$body" | grep -qiE 'already|exist'; then
    log "domain already attached"
  else
    warn "domain attach returned HTTP $status — if the zone lives on another Cloudflare account,"
    warn "bind $DOMAIN in the Pages project settings (dashboard) instead"
  fi
}
attach_domain

wait_for_domain() { # 0 once $PROBE_URL serves; ~10 min of retries
  local tries=40 i=1
  until curl -fsI --max-time 20 "$PROBE_URL" >/dev/null 2>&1; do
    if [[ $i -ge $tries ]]; then return 1; fi
    [[ $((i % 4)) -eq 1 ]] && log "waiting for the domain to serve the assets (DNS/cert provisioning, up to ~10 min) — attempt $i/$tries"
    sleep 15
    i=$((i + 1))
  done
  return 0
}

if [[ $SWITCH -eq 1 ]]; then
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
  if [[ $TARGET == monitor ]]; then
    log "switching the monitor to the new image"
    MC=(-f "$MON_BASE")
    [[ -f $MON_BUILD_OV ]] && MC+=(-f "$MON_BUILD_OV")
    docker compose "${MC[@]}" up -d
    HEALTH_URL=http://127.0.0.1:8090/actuator/health
    WHAT=monitor
  else
    log "switching the store to the new image"
    docker compose --profile app up -d
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
  if curl -fsI --max-time 20 "$PROBE_URL" >/dev/null 2>&1; then
    log "domain is already serving the published assets"
  else
    log "domain provisioning started — DNS/cert usually take a few minutes"
  fi
  # upgrade.sh sets DEPLOY_ASSETS_HOOK=1 for its post-deploy re-publish: the
  # cutover hint does not apply there (the new container already runs).
  if [[ ${DEPLOY_ASSETS_HOOK:-} != 1 ]]; then
    cat <<NEXT

Assets published to Pages. To cut the $TARGET over (its host):
  scripts/deploy-assets.sh --switch        # waits for the domain, then switches
NEXT
  fi
fi
