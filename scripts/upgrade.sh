#!/usr/bin/env bash
#
# Unattended upgrade of an existing deployment (DEPLOYMENT.md "Upgrades" /
# "Automated deploys"). One script, two hosts; both modes pin the checkout to
# the target commit (tracked files only — the untracked .env is never touched,
# local edits to tracked files are discarded), restart via compose, wait for
# health, and roll back to the previous version when anything fails.
#
#   store host (default) — CI runs this over SSH after a green build
#   (.github/workflows/ci.yml, deploy job); by hand it works the same:
#
#     sudo scripts/upgrade.sh                      # deploy origin/main
#     sudo scripts/upgrade.sh --ref <sha|tag>      # deploy an exact commit
#
#   monitor host (split deployment) — deploys an exact revision without
#   waiting for another CI system to publish a mutable :latest image:
#
#     sudo scripts/upgrade.sh --monitor [--ref <sha>] [--path <checkout>]
#     # from another checkout / Jenkins (script read from git via stdin):
#     git show <sha>:scripts/upgrade.sh | sudo bash -s -- --monitor \
#       --path /opt/infinia-store --ref <sha>
#
#   A host already running the standalone monitor (and no store) upgrades the
#   monitor automatically, even without --monitor.
#
# Options:
#   --ref <sha|tag>   commit to deploy (default origin/main)
#   --monitor         upgrade the standalone monitor instead of the store
#   --path <dir>      checkout to run in (default: this script's repo root;
#                     required when the script itself is piped via stdin)
#
# Requirements: the repo cloned on this host with credentials for an
# unattended `git fetch origin` (GitHub deploy key or credential helper) and a
# working Docker Engine + compose plugin.
set -euo pipefail

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- flags -----
ORIGINAL_ARGS=("$@")
REF="origin/main"
DEPLOY_PATH=""
MONITOR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)     REF=${2:?}; shift 2 ;;
    --path)    DEPLOY_PATH=${2:?}; shift 2 ;;
    --monitor) MONITOR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         usage >&2; die "unknown option: $1" ;;
  esac
done

# ------------------------------------------------------------- locate -------
# Stdin invocation (git show … | bash -s --) has no usable $0 — --path drives.
if [[ -n $DEPLOY_PATH ]]; then
  cd "$DEPLOY_PATH"
else
  cd "$(dirname "$0")/.."
fi

# ---------------------------------------------------------- host checks -----
[[ $(uname -s) == "Linux" ]] || die "this upgrader targets Linux production hosts"
if [[ ${EUID} -ne 0 ]]; then
  # Never prompt: unattended callers (CI, cron) must fail fast instead.
  command -v sudo >/dev/null 2>&1 || die "must run as root (try: sudo scripts/upgrade.sh [--monitor])"
  if [[ -f $0 ]]; then
    exec sudo -n bash "$0" "${ORIGINAL_ARGS[@]}"
  else
    die "must run as root — stdin invocation cannot self-elevate; prefix sudo"
  fi
fi
[[ -f docker-compose.yml ]] || die "run from the repo checkout (docker-compose.yml not found)"
command -v git >/dev/null 2>&1 || die "git not installed"
docker info >/dev/null 2>&1 || die "docker daemon not reachable"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# Host detection: a box running the standalone monitor (and no store) means a
# bare upgrade targets the monitor; explicit --monitor wins either way, and
# store hosts (single-host installs included) are never misdetected because
# their store container answers the probe.
if [[ $MONITOR -eq 0 ]]; then
  MON_RUNNING=$(docker compose -f docker-compose.monitor.yml ps -q monitor 2>/dev/null || true)
  STORE_RUNNING=$(docker compose --profile app ps -q store 2>/dev/null || true)
  if [[ -n $MON_RUNNING && -z $STORE_RUNNING ]]; then
    log "standalone monitor detected — upgrading the monitor (store upgrades run on the store host)"
    MONITOR=1
  fi
fi

# ====================================================== monitor host =========
if [[ $MONITOR -eq 1 ]]; then
  COMPOSE_FILE="docker-compose.monitor.yml"
  OVERRIDE=".monitor-release.yml"
  [[ -f $COMPOSE_FILE ]] || die "$COMPOSE_FILE not found"
  [[ -f .env ]] || die "existing monitor .env is required (bootstrap with scripts/deploy.sh --monitor-host)"
  exec 9>.git/monitor-deploy.lock
  flock -n 9 || die "another monitor deployment is active"

  OLD_REF=$(git rev-parse HEAD)
  OLD_CID=$(docker compose -f "$COMPOSE_FILE" ps -q monitor)
  OLD_IMAGE=
  if [[ -n $OLD_CID ]]; then
    OLD_IMAGE=$(docker inspect -f '{{.Image}}' "$OLD_CID")
  fi
  BACKUP=$(mktemp)
  HAD_OVERRIDE=0
  if [[ -f $OVERRIDE ]]; then cp "$OVERRIDE" "$BACKUP"; HAD_OVERRIDE=1; fi
  trap 'rm -f "$BACKUP"' EXIT

  rollback() {
    trap - ERR
    warn "monitor deploy failed; restoring ${OLD_REF:0:12}"
    git checkout --detach "$OLD_REF"
    if [[ $HAD_OVERRIDE -eq 1 ]]; then
      cp "$BACKUP" "$OVERRIDE"
    elif [[ -n $OLD_IMAGE ]]; then
      printf 'services:\n  monitor:\n    image: "%s"\n' "$OLD_IMAGE" > "$OVERRIDE"
    fi
    if [[ -n $OLD_IMAGE ]]; then
      docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE" up -d --no-build --pull never --wait --wait-timeout 300 || true
    fi
    die "rolled back to ${OLD_REF:0:12} (investigate: docker compose -f $COMPOSE_FILE logs --tail 100 monitor)"
  }

  git fetch origin --prune
  NEW_REF=$(git rev-parse --verify "${REF}^{commit}") || die "unknown ref: $REF"
  trap rollback ERR
  log "monitor: ${OLD_REF:0:12} -> ${NEW_REF:0:12}"
  git checkout --detach "$NEW_REF"
  # Asset offload: bake the same origin the Pages publish uses (see below).
  ASSETS_URL_VALUE=$(grep -E '^ASSETS_BASE_URL=' .env | head -1 | cut -d= -f2- || true)
  ASSETS_BUILD_ARG=()
  if [[ $ASSETS_URL_VALUE == http* ]]; then
    ASSETS_BUILD_ARG=(--build-arg "ASSETS_BASE_URL=$ASSETS_URL_VALUE")
  fi
  IMAGE="infinia-monitor:$NEW_REF"
  docker build -f Dockerfile.monitor "${ASSETS_BUILD_ARG[@]}" \
    --label "org.opencontainers.image.revision=$NEW_REF" -t "$IMAGE" .
  # Publish this exact image before exposing its HTML shell. A failed upload
  # or domain verification leaves the old container serving and rolls back.
  if [[ $ASSETS_URL_VALUE == https://* ]]; then
    log "publishing and verifying the next monitor's assets before cutover"
    ASSETS_BASE_URL="$ASSETS_URL_VALUE" DEPLOY_ASSETS_HOOK=1 DEPLOY_ASSETS_IMAGE="$IMAGE" \
      scripts/deploy-assets.sh --monitor --from-image --wait-assets
  fi
  printf 'services:\n  monitor:\n    image: "%s"\n' "$IMAGE" > "$OVERRIDE"
  docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE" up -d --no-build --pull never --wait --wait-timeout 300
  CID=$(docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE" ps -q monitor)
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$CID") == healthy ]]
  [[ $(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CID") == "$NEW_REF" ]]
  trap - ERR
  log "monitor deployed and healthy: ${NEW_REF:0:12}"

  exit 0
fi

# ========================================================= store host ========
# ------------------------------------------------------------ fetch ---------
OLD_REF=$(git rev-parse HEAD)
log "fetching origin (current checkout: ${OLD_REF:0:12})"
git fetch origin --prune
NEW_REF=$(git rev-parse --verify "${REF}^{commit}") || die "unknown ref: $REF"

# ------------------------------------------ profiles & rollback snapshot ----
# The `app` profile always; the co-located monitor (single-host install)
# rides along when its container exists, so split deployments are unaffected.
PROFILES=(--profile app)
WITH_MONITOR=0
if [[ -n "$(docker compose ps -q monitor 2>/dev/null || true)" ]]; then
  PROFILES+=(--profile monitor)
  WITH_MONITOR=1
fi
log "compose profiles: ${PROFILES[*]}"

# The rebuild below retags :latest, so snapshot the currently running image
# first; a failed deploy then rolls back with one retag + compose up.
if docker image inspect infinia-webservice:latest >/dev/null 2>&1; then
  docker tag infinia-webservice:latest infinia-webservice:rollback
else
  warn "no existing infinia-webservice image — nothing to roll back to on failure"
fi
if [[ $WITH_MONITOR -eq 1 ]] && docker image inspect infinia-monitor:latest >/dev/null 2>&1; then
  docker tag infinia-monitor:latest infinia-monitor:rollback
fi

rollback() {
  warn "deploy failed — restoring the previous version (${OLD_REF:0:12})"
  git checkout -f --detach "$OLD_REF" >/dev/null 2>&1 || true
  if docker image inspect infinia-webservice:rollback >/dev/null 2>&1; then
    docker tag infinia-webservice:rollback infinia-webservice:latest
  fi
  if [[ $WITH_MONITOR -eq 1 ]] && docker image inspect infinia-monitor:rollback >/dev/null 2>&1; then
    docker tag infinia-monitor:rollback infinia-monitor:latest
  fi
  docker compose "${PROFILES[@]}" up -d --no-build \
    || warn "rollback 'up -d' reported an error — check: docker compose ps"
  die "rolled back to ${OLD_REF:0:12} (investigate: docker compose logs --tail 100 store)"
}

wait_healthy() { # wait_healthy <service> <timeout-seconds>; 0 = healthy, 1 = not
  local svc=$1 timeout=$2 waited=0 cid st
  cid=$(docker compose ps -q "$svc")
  if [[ -z $cid ]]; then
    warn "container '$svc' is not running"
    return 1
  fi
  while :; do
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo starting)
    if [[ $st == healthy ]]; then
      log "$svc is healthy"
      return 0
    fi
    # A slow first boot (cold-catalog upstream sync) can hold the container
    # unhealthy for minutes before it recovers — only treat persistent
    # unhealthy as failure; the overall timeout still bounds the wait.
    if [[ $st == unhealthy && $waited -ge 420 ]]; then
      docker compose logs --tail 50 "$svc" || true
      return 1
    fi
    if [[ $waited -ge $timeout ]]; then
      docker compose logs --tail 50 "$svc" || true
      return 1
    fi
    waited=$((waited + 5))
    sleep 5
  done
}

# ------------------------------------------------------ checkout & build ----
log "checkout ${OLD_REF:0:12} -> ${NEW_REF:0:12}"
git checkout -f --detach "$NEW_REF" >/dev/null

log "building the next images (the current containers keep serving)"
ASSETS_URL_VALUE=$(grep -E '^ASSETS_BASE_URL=' .env | head -1 | cut -d= -f2- || true)
ASSETS_BASE_URL="$ASSETS_URL_VALUE" docker compose "${PROFILES[@]}" build || rollback
if [[ $ASSETS_URL_VALUE == https://* ]]; then
  log "publishing and verifying the next store's assets before cutover"
  ASSETS_BASE_URL="$ASSETS_URL_VALUE" DEPLOY_ASSETS_HOOK=1 DEPLOY_ASSETS_IMAGE=infinia-webservice \
    scripts/deploy-assets.sh --from-image --wait-assets || rollback
fi
log "restarting with the verified images"
docker compose "${PROFILES[@]}" up -d --no-build || rollback

if ! wait_healthy store 900; then rollback; fi
if [[ $WITH_MONITOR -eq 1 ]]; then
  if ! wait_healthy monitor 300; then rollback; fi
fi

# Loopback sanity probe, warn-only (same as deploy.sh — a rebinding
# STORE_BIND_HOST can make 127.0.0.1 the wrong address to test).
curl -fsS http://127.0.0.1:8080/actuator/health | grep -q '"UP"' \
  || warn "store health endpoint did not report UP"
if [[ $WITH_MONITOR -eq 1 ]]; then
  curl -fsS http://127.0.0.1:8090/actuator/health >/dev/null \
    || warn "monitor health endpoint not reachable"
fi

# Drop the dangling layers the rebuild left behind so repeated deploys don't
# creep the disk (tagged images — including :rollback — are kept).
docker image prune -f >/dev/null

log "deployed ${NEW_REF:0:12} (was ${OLD_REF:0:12}); rollback image kept as infinia-webservice:rollback"
