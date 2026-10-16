#!/usr/bin/env bash
#
# One-click host deployment for FengYu-WebSite (Linux, root or
# sudo, from the repo checkout). One script, two hosts (DEPLOYMENT.md):
#
#   store host (default) — the full stack behind a reverse proxy / WAF:
#     sudo scripts/deploy.sh --base-url https://store.example.com
#
#   monitor host (split deployment, ADR-011 — the status page must survive a
#   store outage):
#     sudo scripts/deploy.sh --monitor-host --target-url https://store.example.com
#
# Both modes: (1.) rewrite Debian/Ubuntu apt sources to a domestic mirror,
# (2.) install Docker Engine + buildx + compose plugin (Aliyun docker-ce repo,
# get.docker.com --mirror Aliyun as fallback), (3.) configure docker registry
# mirrors in /etc/docker/daemon.json, (4.) generate .env, (5.) start and wait
# for health. Idempotent: an existing .env and any existing registry-mirrors
# config are preserved; apt sources are backed up to
# /etc/apt/deploy-backup-<ts>.tgz.
#
# Store options:
#   --base-url URL         public https:// URL of the store (STORE_BASE_URL)
#   --monitor-url URL      URL the co-located monitor probes (default: --base-url)
#   --with-monitor         also run the status monitor on this host
#                           (single-host installs; the split deployment uses
#                           --monitor-host on its own server instead)
# Monitor-host options:
#   --monitor-host         deploy the standalone monitor (this mode)
#   --target-url URL       the store's URL as THIS host reaches it (required;
#                           through the WAF's public https URL preferred)
#   --image-registry HOST  image registry prefix (default ghcr.io; use a GHCR
#                           proxy such as ghcr.m.daocloud.io when direct
#                           ghcr.io pulls are slow/unreachable)
#   --image-tag TAG        image tag (default latest; pin a digest for
#                           immutability)
#   --build                build the image locally (Dockerfile.monitor) instead
#                           of pulling — slow, only for air-gapped networks
# Shared options:
#   --alert-webhook URL    MONITOR_ALERT_WEBHOOK (optional)
#   --registry-mirror URL  docker registry mirror; repeatable
#                           (default: docker.m.daocloud.io docker.1ms.run)
#   --no-mirror            leave /etc/docker/daemon.json untouched
#   --apt-mirror HOST      apt source host for Debian/Ubuntu
#                           (default mirrors.aliyun.com; --no-apt-mirror skips)
#   --skip-docker          assume Docker + compose are already installed
#   --force-env            regenerate .env even if one exists
#   --no-up                prepare everything but do not build/pull/start
#   --yes, -y              non-interactive: never prompt, accept defaults
#   -h, --help             this help
#
# Configuration — precedence: flags > environment variables > deploy.conf
# (repo root, gitignored) > built-in defaults. Keys read here:
#   STORE_BASE_URL, MONITOR_TARGET_BASE_URL, MONITOR_ALERT_WEBHOOK,
#   MONITOR_IMAGE_REGISTRY, MONITOR_IMAGE_TAG, APT_MIRROR,
#   REGISTRY_MIRRORS (space-separated)
# Interactive: on a terminal the script asks which host to deploy whenever
# the flags don't already imply it (monitor-only flags like --target-url
# select the monitor host; store flags select the store), and asks for any
# required value it is missing. Answers accept store/monitor (or 商店/监
# 控); --yes keeps it fully unattended. A host already running the standalone
# monitor is preselected automatically.
#
# The repo must already be on the host (git clone / rsync); the store's first
# build pulls base images plus Maven/npm dependencies and can take a while.
set -euo pipefail
cd "$(dirname "$0")/.."

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- flags -----
ORIGINAL_ARGS=("$@")
MODE="store"
MODE_EXPLICIT=0
STORE_HINT=0
MON_HINT=0
BASE_URL=""
MONITOR_URL=""
TARGET_URL=""
ALERT_WEBHOOK=""
IMAGE_REGISTRY="ghcr.io"
IMAGE_TAG="latest"
BUILD_LOCAL=0
REGISTRY_MIRRORS=()
NO_MIRROR=0
APT_MIRROR="mirrors.aliyun.com"
SKIP_DOCKER=0
FORCE_ENV=0
NO_UP=0
WITH_MONITOR=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --monitor-host)    MODE="monitor"; MODE_EXPLICIT=1; shift ;;
    --base-url)        BASE_URL=${2:?}; STORE_HINT=1; shift 2 ;;
    --monitor-url)     MONITOR_URL=${2:?}; STORE_HINT=1; shift 2 ;;
    --target-url)      TARGET_URL=${2:?}; MON_HINT=1; shift 2 ;;
    --alert-webhook)   ALERT_WEBHOOK=${2:?}; shift 2 ;;
    --image-registry)  IMAGE_REGISTRY=${2:?}; MON_HINT=1; shift 2 ;;
    --image-tag)       IMAGE_TAG=${2:?}; MON_HINT=1; shift 2 ;;
    --build)           BUILD_LOCAL=1; MON_HINT=1; shift ;;
    --registry-mirror) REGISTRY_MIRRORS+=("${2:?}"); shift 2 ;;
    --no-mirror)       NO_MIRROR=1; shift ;;
    --apt-mirror)      APT_MIRROR=${2:?}; shift 2 ;;
    --no-apt-mirror)   APT_MIRROR=""; shift ;;
    --skip-docker)     SKIP_DOCKER=1; shift ;;
    --force-env)       FORCE_ENV=1; shift ;;
    --no-up)           NO_UP=1; shift ;;
    --with-monitor)    WITH_MONITOR=1; STORE_HINT=1; shift ;;
    --yes|-y)          ASSUME_YES=1; shift ;;
    -h|--help)         sed -n '2,63p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                 sed -n '2,63p' "$0" | sed 's/^# \{0,1\}//' >&2; die "unknown option: $1" ;;
  esac
done

# ---------------------------------------------------------- host checks -----
[[ $(uname -s) == "Linux" ]] || die "this deployer targets Linux production hosts; on macOS use Docker Desktop + the manual steps in DEPLOYMENT.md"
if [[ ${EUID} -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "must run as root (try: sudo scripts/deploy.sh [--monitor-host])"
  log "not root — re-running with sudo"
  # ORIGINAL_ARGS: the parse loop above consumed $@, and plain "$@" would
  # silently drop every flag on this re-exec.
  exec sudo bash "$0" "${ORIGINAL_ARGS[@]}"
fi
[[ -f docker-compose.yml ]] || die "run from the repo (docker-compose.yml not found next to scripts/)"

# ---------------------------------------------------- configuration ---------
# Precedence: flags > environment variables > deploy.conf > built-in defaults.
# Loaded AFTER the sudo re-exec so nothing depends on the pre-sudo shell.
CONFIG_FILE=deploy.conf
INTERACTIVE=0
[[ -t 0 && $ASSUME_YES -eq 0 ]] && INTERACTIVE=1

load_config() { # KEY=VALUE file; real environment variables keep precedence
  [[ -f $CONFIG_FILE ]] || return 0
  local line key val
  while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}; val=${line#*=}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Keys with same-named script variables (arrays / defaulted strings) are
    # read explicitly below instead of exported here.
    [[ $key == APT_MIRROR || $key == REGISTRY_MIRRORS ]] && continue
    [[ -n ${!key+x} ]] || export "$key=$val"
  done < "$CONFIG_FILE"
}
load_config

ask() { # ask <prompt> [default] — answer in REPLY
  local prompt=$1 def=${2:-}
  if [[ -n $def ]]; then
    read -r -e -p "$prompt [$def]: " REPLY || die "no input available"
    REPLY=${REPLY:-$def}
  else
    read -r -e -p "$prompt: " REPLY || die "no input available"
  fi
}

# Host selection: explicit --monitor-host wins; host-specific flags imply
# the host; a box already running the standalone monitor (and no store) is
# preselected; otherwise a terminal gets the question, unattended gets store.
if [[ $MODE_EXPLICIT -eq 0 && $MON_HINT -eq 1 && $STORE_HINT -eq 0 ]]; then
  MODE="monitor"; MODE_EXPLICIT=1
  log "monitor-only flags given — deploying the monitor host"
fi
DEFAULT_HOST="store"
if [[ $MODE_EXPLICIT -eq 0 ]]; then
  MON_RUNNING=$(docker compose -f docker-compose.monitor.yml ps -q monitor 2>/dev/null || true)
  STORE_RUNNING=$(docker compose --profile app ps -q store 2>/dev/null || true)
  if [[ -n $MON_RUNNING && -z $STORE_RUNNING ]]; then
    DEFAULT_HOST="monitor"
    [[ $INTERACTIVE -eq 1 ]] || { MODE="monitor"; MODE_EXPLICIT=1; log "standalone monitor detected on this host — monitor it is"; }
  fi
fi
if [[ $INTERACTIVE -eq 1 && $MODE_EXPLICIT -eq 0 ]]; then
  while :; do
    ask "Deploy which host — store (full stack) or monitor (standalone status page)" "$DEFAULT_HOST"
    case $REPLY in
      s*|S*|商*|店*) break ;;
      m*|M*|监*)     MODE="monitor"; MODE_EXPLICIT=1; break ;;
      *)             warn "answer 'store' or 'monitor' (商店 / 监控)" ;;
    esac
  done
fi
if [[ $MODE == monitor ]]; then
  COMPOSE_FILE="docker-compose.monitor.yml"
  [[ -f $COMPOSE_FILE ]] || die "$COMPOSE_FILE not found — run from the repo root"
fi
# Co-located monitor question only on a fresh bootstrap (no .env yet).
if [[ $MODE == store && $INTERACTIVE -eq 1 && $WITH_MONITOR -eq 0 && ! -f .env ]]; then
  ask "Also run the co-located status monitor on this host (single-host install)" "n"
  [[ $REPLY == [Yy]* ]] && WITH_MONITOR=1
fi

# flag > environment > deploy.conf > built-in default. Empty string means
# "unset" for the URL/webhook flags; the defaulted strings (APT_MIRROR,
# IMAGE_*) only take the config value while still at their default.
BASE_URL=${BASE_URL:-${STORE_BASE_URL:-}}
TARGET_URL=${TARGET_URL:-${MONITOR_TARGET_BASE_URL:-}}
ALERT_WEBHOOK=${ALERT_WEBHOOK:-${MONITOR_ALERT_WEBHOOK:-}}
conf_pref() { # conf_pref <current> <config-key> — config value unless overridden
  local cur=$1 key=$2 v=""
  [[ -f $CONFIG_FILE ]] && v=$(grep -E "^${key}=" "$CONFIG_FILE" | head -1 | cut -d= -f2- || true)
  [[ -n $v && $cur == "$3" ]] && printf '%s' "$v" || printf '%s' "$cur"
}
IMAGE_REGISTRY=$(conf_pref "$IMAGE_REGISTRY" MONITOR_IMAGE_REGISTRY "ghcr.io")
IMAGE_TAG=$(conf_pref "$IMAGE_TAG" MONITOR_IMAGE_TAG "latest")
APT_MIRROR=$(conf_pref "$APT_MIRROR" APT_MIRROR "mirrors.aliyun.com")

if [[ ${#REGISTRY_MIRRORS[@]} -eq 0 && $NO_MIRROR -eq 0 ]]; then
  CONF_MIRRORS=""
  [[ -f $CONFIG_FILE ]] && CONF_MIRRORS=$(grep -E '^REGISTRY_MIRRORS=' "$CONFIG_FILE" | head -1 | cut -d= -f2- || true)
  if [[ -n $CONF_MIRRORS ]]; then
    read -ra REGISTRY_MIRRORS <<< "$CONF_MIRRORS"
  else
    # Public mirrors change availability often; override with --registry-mirror.
    REGISTRY_MIRRORS=("https://docker.m.daocloud.io" "https://docker.1ms.run")
  fi
fi

# -------------------------------------------------------- distro detect -----
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "/etc/os-release missing — unsupported distro"
fi
PKG=""
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
fi

pkg_install() { # pkg_install <pkg...>
  if [[ $PKG == apt ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif [[ $PKG == dnf ]]; then
    dnf install -y "$@"
  elif [[ $PKG == yum ]]; then
    yum install -y "$@"
  else
    die "no supported package manager (apt/dnf/yum) — install manually: $*"
  fi
}

# ------------------------------------------------- 1. apt source mirror -----
if [[ -n $APT_MIRROR && $PKG == apt ]]; then
  if grep -rqF "$APT_MIRROR" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
    log "apt sources already point at $APT_MIRROR — skipping rewrite"
  else
    STAMP=$(date +%Y%m%dT%H%M%S)
    BACKUP="/etc/apt/deploy-backup-$STAMP.tgz"
    tar -czf "$BACKUP" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true
    log "apt sources backed up to $BACKUP"
    # Host-only rewrite keeps the original scheme (http/https) and suite paths;
    # covers both classic *.list and deb822 *.sources (Ubuntu 24.04+).
    find -H /etc/apt -maxdepth 2 \
      \( -name '*.list' -o -name '*.sources' \) -type f -exec \
      sed -i -E "s#(https?://)(archive\.ubuntu\.com|cn\.archive\.ubuntu\.com|security\.ubuntu\.com|deb\.debian\.org|security\.debian\.org|mirrors\.cloud\.aliyuncs\.com)/#\1${APT_MIRROR}/#g" {} +
    log "apt sources rewritten to $APT_MIRROR"
    apt-get update
  fi
elif [[ -n $APT_MIRROR ]]; then
  log "not a Debian/Ubuntu host — skipping apt mirror rewrite"
fi

# ---------------------------------------------------- 2. install docker -----
install_docker() {
  log "installing Docker Engine + compose plugin"
  if [[ $PKG == apt && -n ${VERSION_CODENAME:-} ]]; then
    pkg_install ca-certificates curl openssl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://mirrors.aliyun.com/docker-ce/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.aliyun.com/docker-ce/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update
    pkg_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif [[ $PKG == dnf || $PKG == yum ]]; then
    repo_distro=centos; if [[ ${ID:-} == fedora ]]; then repo_distro=fedora; fi
    if [[ $PKG == dnf ]]; then
      dnf -y config-manager --add-repo "https://mirrors.aliyun.com/docker-ce/linux/${repo_distro}/docker-ce.repo"
    else
      pkg_install yum-utils
      yum-config-manager --add-repo "https://mirrors.aliyun.com/docker-ce/linux/${repo_distro}/docker-ce.repo"
    fi
    pkg_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    # Unknown/derivative distro: the upstream installer knows the edge cases
    # and has a built-in Aliyun mirror mode for CN hosts.
    log "no apt/dnf/yum repo path — falling back to get.docker.com --mirror Aliyun"
    pkg_install curl openssl || true
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh --mirror Aliyun
  fi
  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
}

if [[ $SKIP_DOCKER -eq 1 ]]; then
  log "--skip-docker: trusting the host's Docker install"
else
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    log "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || docker --version | awk '{print $3}' | tr -d ,) already working — skipping install"
  else
    install_docker
  fi
fi
command -v docker >/dev/null 2>&1 || die "docker not installed"
docker info >/dev/null 2>&1 || die "docker daemon not reachable (systemctl status docker?)"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing — install docker-compose-plugin"

# ---------------------------------------------- 3. registry mirrors ---------
# Only Docker Hub pulls consult these; GHCR images (monitor, CI store image)
# use the registry override / GHCR proxy variables instead.
if [[ $NO_MIRROR -eq 1 ]]; then
  log "--no-mirror: leaving /etc/docker/daemon.json untouched"
else
  CFG=/etc/docker/daemon.json
  mkdir -p /etc/docker
  MIRRORS_JSON=$(printf '%s\n' "${REGISTRY_MIRRORS[@]}" | sed 's/^/"/;s/$/"/' | paste -sd, - | sed 's/^/[/;s/$/]/')
  if [[ -f $CFG ]] && grep -q 'registry-mirrors' "$CFG"; then
    log "daemon.json already defines registry-mirrors — keeping them"
  elif [[ ! -f $CFG ]]; then
    printf '{\n  "registry-mirrors": %s\n}\n' "$MIRRORS_JSON" > "$CFG"
    log "registry mirrors written to $CFG: ${REGISTRY_MIRRORS[*]}"
    systemctl restart docker 2>/dev/null || service docker restart
  elif command -v python3 >/dev/null 2>&1; then
    cp -a "$CFG" "${CFG}.bak-$(date +%Y%m%dT%H%M%S)"
    MIRRORS_JSON=$MIRRORS_JSON python3 - <<'PY'
import json, os
path = "/etc/docker/daemon.json"
with open(path) as f:
    cfg = json.load(f)
cfg["registry-mirrors"] = json.loads(os.environ["MIRRORS_JSON"])
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
    log "registry mirrors merged into $CFG (backup kept alongside)"
    systemctl restart docker 2>/dev/null || service docker restart
  elif command -v jq >/dev/null 2>&1; then
    cp -a "$CFG" "${CFG}.bak-$(date +%Y%m%dT%H%M%S)"
    tmp=$(mktemp)
    jq --argjson m "$MIRRORS_JSON" '.["registry-mirrors"] = $m' "$CFG" > "$tmp" && mv "$tmp" "$CFG"
    log "registry mirrors merged into $CFG (backup kept alongside)"
    systemctl restart docker 2>/dev/null || service docker restart
  else
    warn "daemon.json exists but neither python3 nor jq is available to merge — add manually: \"registry-mirrors\": $MIRRORS_JSON"
  fi
fi

# Compose arguments for the current mode/branch (consumed by wait_healthy).
COMPOSE_ARGS=()

wait_healthy() { # wait_healthy <service> <timeout-seconds>; uses COMPOSE_ARGS
  local svc=$1 timeout=$2 waited=0 cid st
  cid=$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null)
  if [[ -z $cid ]]; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail 50 "$svc" || true
    die "container '$svc' is not running"
  fi
  while :; do
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo starting)
    if [[ $st == healthy ]]; then
      log "$svc is healthy"
      return 0
    fi
    # Same slow-first-boot tolerance as upgrade.sh (cold-catalog sync).
    if [[ $st == unhealthy && $waited -ge 420 ]]; then
      docker compose "${COMPOSE_ARGS[@]}" logs --tail 50 "$svc" || true
      die "$svc reports unhealthy"
    fi
    if [[ $waited -ge $timeout ]]; then
      docker compose "${COMPOSE_ARGS[@]}" logs --tail 50 "$svc" || true
      die "$svc did not become healthy within ${timeout}s"
    fi
    waited=$((waited + 5))
    sleep 5
  done
}

# ---------------------------------------------------- 4. generate .env -----
command -v openssl >/dev/null 2>&1 || pkg_install openssl

if [[ $MODE == monitor ]]; then
  # The monitor's .env is minimal: where the store is, optional webhook and
  # image pinning. No stack credentials live on this host by design (ADR-011).
  if [[ -f .env && $FORCE_ENV -eq 0 ]]; then
    log ".env already exists — keeping it (use --force-env to regenerate)"
    TARGET_URL=$(grep -E '^MONITOR_TARGET_BASE_URL=' .env | cut -d= -f2- || true)
  else
    if [[ -z $TARGET_URL ]]; then
      if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
        read -r -e -p "Store URL as this host reaches it (MONITOR_TARGET_BASE_URL, e.g. https://store.example.com): " TARGET_URL
      fi
    fi
    [[ -n $TARGET_URL ]] || die "--target-url is required (the store's URL as this host reaches it — through the WAF's public https URL preferred)"
    {
      printf '# Generated by scripts/deploy.sh --monitor-host on %s.\n' "$(date -u +%FT%TZ)"
      printf 'MONITOR_TARGET_BASE_URL=%s\n' "$TARGET_URL"
      if [[ -n $ALERT_WEBHOOK ]]; then
        printf 'MONITOR_ALERT_WEBHOOK=%s\n' "$ALERT_WEBHOOK"
      else
        printf '#MONITOR_ALERT_WEBHOOK=\n'
      fi
      if [[ $IMAGE_REGISTRY != "ghcr.io" ]]; then
        printf 'MONITOR_IMAGE_REGISTRY=%s\n' "$IMAGE_REGISTRY"
      fi
      if [[ $IMAGE_TAG != "latest" ]]; then
        printf 'MONITOR_IMAGE_TAG=%s\n' "$IMAGE_TAG"
      fi
    } > .env
    chmod 600 .env
    log ".env generated: MONITOR_TARGET_BASE_URL=$TARGET_URL registry=$IMAGE_REGISTRY tag=$IMAGE_TAG"
  fi
  # grep's non-match must not become a silent set-e exit — the die below is the
  # intended diagnostic when .env predates this variable (e.g. copied from
  # .env.example, where the line ships commented out).
  if [[ -z $TARGET_URL ]]; then
    TARGET_URL=$(grep -E '^MONITOR_TARGET_BASE_URL=' .env | cut -d= -f2- || true)
  fi
  [[ -n $TARGET_URL ]] || die ".env has no MONITOR_TARGET_BASE_URL — rerun with --target-url or --force-env"
else
  if [[ -f .env && $FORCE_ENV -eq 0 ]]; then
    log ".env already exists — keeping it (use --force-env to re-roll secrets)"
  else
    if [[ -f .env ]]; then
      cp -a .env ".env.bak-$(date +%Y%m%dT%H%M%S)"
      warn "old .env backed up; re-rolling all secrets invalidates nothing in the data plane, but note POSTGRES/MINIO password changes need the old values for existing volumes"
    fi
    if [[ -z $BASE_URL ]]; then
      DEFAULT_URL="http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1):8080"
      if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
        read -r -e -p "Public URL browsers use to reach the store (STORE_BASE_URL, e.g. https://store.example.com) [$DEFAULT_URL]: " BASE_URL
        BASE_URL=${BASE_URL:-$DEFAULT_URL}
      else
        BASE_URL=$DEFAULT_URL
        warn "no --base-url given; defaulting STORE_BASE_URL to $BASE_URL — set the real https:// domain in .env before going live"
      fi
    fi
    if [[ -z $MONITOR_URL ]]; then MONITOR_URL=$BASE_URL; fi

    {
      printf '# Generated by scripts/deploy.sh on %s — treat as secret.\n' "$(date -u +%FT%TZ)"
      printf 'STORE_TICKET_SECRET=%s\n'   "$(openssl rand -hex 32)"
      printf 'STORE_ROLLOUT_SECRET=%s\n'  "$(openssl rand -hex 32)"
      printf 'STORE_CLI_CLIENT_SECRET=%s\n' "$(openssl rand -hex 32)"
      printf 'STORE_BASE_URL=%s\n' "$BASE_URL"
      printf 'MONITOR_TARGET_BASE_URL=%s\n' "$MONITOR_URL"
      if [[ -n $ALERT_WEBHOOK ]]; then
        printf 'MONITOR_ALERT_WEBHOOK=%s\n' "$ALERT_WEBHOOK"
      else
        printf '#MONITOR_ALERT_WEBHOOK=\n'
      fi
      printf 'POSTGRES_DB=store\nPOSTGRES_USER=store\n'
      printf 'POSTGRES_PASSWORD=%s\n'    "$(openssl rand -hex 24)"
      printf 'MINIO_ROOT_USER=store\n'
      printf 'MINIO_ROOT_PASSWORD=%s\n'  "$(openssl rand -hex 24)"
      printf '#DOCKER_CPUS_LIMIT=2\n#DOCKER_MEM_LIMIT=1g\n'
    } > .env
    chmod 600 .env
    log ".env generated (secrets rolled, mode 600): STORE_BASE_URL=$BASE_URL"
  fi
fi

# ------------------------------------------------- 5. build & start --------
if [[ $NO_UP -eq 1 ]]; then
  log "--no-up: environment prepared; start later with 'docker compose up -d --build' (store) / 'docker compose -f docker-compose.monitor.yml up -d' (monitor)"
  exit 0
fi

if [[ $MODE == monitor ]]; then
  if [[ $BUILD_LOCAL -eq 1 ]]; then
    log "--build: building the monitor image locally (first build pulls Maven/npm deps — be patient)"
    # The shipped file is pull-only; the override adds the local build section.
    cat > docker-compose.monitor-build.override.yml <<'OVERRIDE'
services:
  monitor:
    build:
      context: .
      dockerfile: Dockerfile.monitor
      args:
        # Interpolated from this host's .env at build time — the asset
        # offload origin (empty keeps monitor assets same-origin).
        ASSETS_BASE_URL: ${ASSETS_BASE_URL:-}
OVERRIDE
    docker compose -f "$COMPOSE_FILE" -f docker-compose.monitor-build.override.yml up -d --build
    COMPOSE_ARGS=(-f "$COMPOSE_FILE" -f docker-compose.monitor-build.override.yml)
    wait_healthy monitor 300
  else
    log "pulling the monitor image ($IMAGE_REGISTRY/muskstark/infinia-store-platform-monitor:$IMAGE_TAG)"
    if ! docker compose -f "$COMPOSE_FILE" pull; then
      die "image pull failed — if ghcr.io is unreachable from this host, retry with --image-registry ghcr.m.daocloud.io, or --build to compile locally"
    fi
    docker compose -f "$COMPOSE_FILE" up -d
    COMPOSE_ARGS=(-f "$COMPOSE_FILE")
    wait_healthy monitor 300
  fi

  log "verifying the monitor endpoint"
  curl -fsS http://127.0.0.1:8090/actuator/health >/dev/null || warn "monitor health endpoint not reachable on 127.0.0.1:8090"

  # The #1 misconfiguration: the monitor cannot reach the store at all
  # (firewall / security group / wrong URL) — probe it once from this host.
  log "probing the store from this host: $TARGET_URL"
  if ! curl -fsS --max-time 10 "$TARGET_URL/actuator/health" 2>/dev/null | grep -q UP; then
    warn "the store did not answer at $TARGET_URL — the monitor will report it DOWN. Check: URL spelling, store-host firewall (DOCKER-USER), cloud security group, and WAF CC rules against this host's polling."
  else
    log "store reachable from this host"
  fi

  cat <<SUMMARY

Monitor is up. Remaining wiring (see DEPLOYMENT.md "Monitor host"):

  1. Reverse proxy / WAF — publish the status page (anonymous by design):
       monitor  -> http://$(hostname -I 2>/dev/null | awk '{print $1}'):8090
     Health-check path: GET /actuator/health. If MONITOR_TARGET_BASE_URL goes
     through the WAF, whitelist this host's IP for CC protection so the
     once-a-minute polling is not blocked.
  2. First status (after ~1 poll cycle):
       curl http://127.0.0.1:8090/api/v1/status     # stale must be false
  3. Useful commands:
       docker compose -f $COMPOSE_FILE ps
       docker compose -f $COMPOSE_FILE logs -f monitor
       sudo scripts/upgrade.sh --monitor --ref origin/main   # pinned upgrade

SUMMARY
  exit 0
fi

# ---- store host --------------------------------------------------------------
log "building and starting the stack (first build pulls Maven/npm deps — be patient)"
PROFILES=(--profile app)
if [[ $WITH_MONITOR -eq 1 ]]; then
  PROFILES+=(--profile monitor)
fi
docker compose "${PROFILES[@]}" up -d --build

COMPOSE_ARGS=("${PROFILES[@]}")
wait_healthy store 900
if [[ $WITH_MONITOR -eq 1 ]]; then
  wait_healthy monitor 300
fi

log "verifying endpoints through the loopback bindings"
curl -fsS http://127.0.0.1:8080/actuator/health | grep -q '"UP"' || warn "store health endpoint did not report UP"
if [[ $WITH_MONITOR -eq 1 ]]; then
  curl -fsS http://127.0.0.1:8090/actuator/health >/dev/null   || warn "monitor health endpoint not reachable"
fi

# ---------------------------------------------------- 6. what's next -------
# Same guard as the monitor branch: a commented-out line in a hand-copied
# .env.example must not kill the script with a silent set-e exit here.
STORE_URL=$(grep -E '^STORE_BASE_URL=' .env | cut -d= -f2- || true)
STORE_URL=${STORE_URL:-<set STORE_BASE_URL in .env>}
cat <<SUMMARY

Deployment is up. Remaining wiring (see DEPLOYMENT.md):

  1. Reverse proxy / WAF (tested: SafeLine) — two sites, HTTP upstreams:
       store    -> http://127.0.0.1:8080   (public: $STORE_URL)
       monitor  -> http://127.0.0.1:8090
     Set the store site's request-body limit to >= 1073741824 (1 GiB) — the
     WAF default is far lower and large artifact uploads will fail with 413.
  2. TLS terminates at the proxy; point STORE_BASE_URL in .env at the public
     https:// domain, then: docker compose --profile app up -d
  3. Backups — add to root's crontab (KEEP_DAYS=14 keeps two weeks):
       30 3 * * * cd $PWD && KEEP_DAYS=14 ./scripts/backup-stack.sh /mnt/backups/infinia
  4. Status monitor — split deployment (default): run it on its OWN host so
     the status page survives a store outage:
       git clone <this repo>; cd FengYu-WebSite
       printf 'MONITOR_TARGET_BASE_URL=%s\n' "$STORE_URL" > .env
       docker compose -f docker-compose.monitor.yml up -d
     (single-host install instead: re-run this script with --with-monitor)
  5. Cloudflare Pages asset offload (optional, fixes first-visit 522s when
     published through Cloudflare):
       scripts/deploy-assets.sh --all
     (interactive configuration on first run; every later upgrade re-publishes
     automatically — DEPLOYMENT.md "Static assets on Cloudflare Pages").
  6. Useful commands:
       docker compose ps
       docker compose logs -f store
       git pull && docker compose --profile app up -d --build   # upgrade

SUMMARY
