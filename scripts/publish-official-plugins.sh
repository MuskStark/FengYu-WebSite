#!/usr/bin/env bash
# Publish official FengYu plugins (.fyp packages) into the Infinia store.
#
# Since FengYu 4.1.0 the host distributions bundle no plugins at all — the
# official catalog lives only here (FengYu's trusted-store-keys.json pins our
# platform Ed25519 key, so a store install is the one official channel). This
# script takes a directory of built .fyp archives, reads each manifest.json
# for identity (id, name, description, version, engines.fengyu), and drives
# the full publisher pipeline per package:
#
#   ensure PLUGIN listing under the `official` namespace (create or reuse)
#     → draft release (requiresHost from engines.fengyu)
#     → presigned PACKAGE upload (universal platform/arch)
#     → submit → async malware scan → approve as PLATFORM_ADMIN
#
# Approval signs the release envelope and every artifact with the platform
# Ed25519 key; the FengYu host refuses fan.summer.* packages without that
# signature, so STORE_APPROVE=0 leaves packages installable by no one.
#
# Usage:
#   scripts/publish-official-plugins.sh <assets-dir-of-fyp-files> [channel]
# Environment:
#   STORE_BASE             store origin     (default http://localhost:8080)
#   STORE_ADMIN_EMAIL      PLATFORM_ADMIN login (default admin@infinia.local)
#   STORE_ADMIN_PASSWORD   its password         (default Password123!)
#   STORE_APPROVE          1 = approve after a clean scan (default 1)
#
# The plugin slug is the manifest id minus its `fan.summer.` prefix, so the
# catalog coordinates read infinia://plugin/official/{email,excel,...} and the
# host's P2-13 ledger binding maps them to the real package ids at install.
set -euo pipefail

ASSETS_DIR="${1:?usage: publish-official-plugins.sh <assets-dir-of-fyp-files> [channel]}"
CHANNEL="${2:-stable}"
STORE_BASE="${STORE_BASE:-http://localhost:8080}"
ADMIN_EMAIL="${STORE_ADMIN_EMAIL:-admin@infinia.local}"
ADMIN_PASSWORD="${STORE_ADMIN_PASSWORD:-Password123!}"
APPROVE="${STORE_APPROVE:-1}"
NAMESPACE="official"
SCAN_TIMEOUT_SECONDS="${SCAN_TIMEOUT_SECONDS:-180}"

[ -d "$ASSETS_DIR" ] || { echo "assets dir not found: $ASSETS_DIR" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

api() { # api METHOD PATH [JSON_BODY] → response body
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' -d "$body" "$STORE_BASE$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$STORE_BASE$path"
  fi
}

code() { # code METHOD PATH → HTTP status
  curl -sS -o /dev/null -w '%{http_code}' -X "$1" -H "Authorization: Bearer $TOKEN" \
    "$STORE_BASE$2"
}

log "authenticating $ADMIN_EMAIL against $STORE_BASE"
LOGIN=$(curl -sS -X POST "$STORE_BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
    '{email:$e, password:$p}')")
TOKEN=$(echo "$LOGIN" | jq -r '.accessToken // empty')
[ -n "$TOKEN" ] || die "admin login failed"
ROLE=$(echo "$LOGIN" | jq -r '.user.roles // [] | join(",")')
case ",$ROLE," in
  *,PLATFORM_ADMIN,*) ;;
  *) die "$ADMIN_EMAIL lacks PLATFORM_ADMIN — self-review approval is impossible" ;;
esac
log "token acquired (PLATFORM_ADMIN)"

# ---- ensure the `official` namespace exists (reserved by its organization) ----
ORGS=$(api GET /api/v1/organizations)
if echo "$ORGS" | jq -e --arg s "$NAMESPACE" 'map(.slug) | index($s)' >/dev/null; then
  log "organization $NAMESPACE exists"
else
  log "creating organization $NAMESPACE (reserves the namespace)"
  ORG=$(api POST /api/v1/organizations \
    "$(jq -n --arg s "$NAMESPACE" '{slug:$s, name:"Infinia Official"}')")
  echo "$ORG" | jq -e '.slug // error("organization rejected: \(.)")' >/dev/null
fi

PUBLISHED=0 SKIPPED=0
shopt -s nullglob
for FILE in "$ASSETS_DIR"/*.fyp; do
  BASENAME=$(basename "$FILE")
  MANIFEST=$(unzip -p "$FILE" manifest.json 2>/dev/null) \
    || die "$BASENAME: no manifest.json inside"
  PLUGIN_ID=$(echo "$MANIFEST" | jq -r '.id // empty')
  [ -n "$PLUGIN_ID" ] || die "$BASENAME: manifest.id missing"
  case "$PLUGIN_ID" in
    fan.summer.*) SLUG="${PLUGIN_ID#fan.summer.}" ;;
    *) SLUG="$PLUGIN_ID" ;;
  esac
  SLUG=$(echo "$SLUG" | tr '[:upper:]' '[:lower:]')
  case "$SLUG" in
    [a-z0-9][a-z0-9-]*) ;; *) die "$BASENAME: unusable slug '$SLUG' from id $PLUGIN_ID" ;;
  esac
  VERSION=$(echo "$MANIFEST" | jq -r '.version // empty')
  if [ -z "$VERSION" ]; then # fall back to the filename convention id-<version>.fyp
    VERSION=${BASENAME%.fyp}
    VERSION="${VERSION#"$PLUGIN_ID"-}"
  fi
  NAME=$(echo "$MANIFEST" | jq -r --arg pid "$PLUGIN_ID" '.name // $pid')
  SUMMARY=$(echo "$MANIFEST" | jq -r '.description // ""')
  CATEGORY=$(echo "$MANIFEST" | jq -r '.category // "plugins"')
  REQUIRES_HOST=$(echo "$MANIFEST" | jq -r '.engines.fengyu // empty')
  SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE")

  log "$BASENAME → $NAMESPACE/$SLUG $VERSION"

  # ---- find or create the listing --------------------------------------------
  STATUS=$(code GET "/api/v1/listings/$NAMESPACE/$SLUG")
  if [ "$STATUS" = "200" ]; then
    LISTING_ID=$(api GET "/api/v1/listings/$NAMESPACE/$SLUG" | jq -r '.listingId')
    log "  listing $NAMESPACE/$SLUG exists ($LISTING_ID)"
  elif [ "$STATUS" = "404" ]; then
    CREATED=$(api POST /api/v1/publisher/listings "$(jq -n \
      --arg ns "$NAMESPACE" --arg slug "$SLUG" --arg name "$NAME" \
      --arg sum "$SUMMARY" --arg ch "$CHANNEL" --arg cat "$CATEGORY" \
      '{namespace:$ns, slug:$slug, type:"PLUGIN", category:$cat,
        tags:["official"], defaultChannel:$ch, name:$name,
        summary:$sum, descriptionMarkdown:$sum, locale:"en"}')")
    LISTING_ID=$(echo "$CREATED" | jq -r '.listingId // empty')
    [ -n "$LISTING_ID" ] || die "  listing creation failed: $CREATED"
    log "  listing created ($LISTING_ID)"
  else
    die "  listing probe failed with HTTP $STATUS"
  fi

  # Official plugins own the featured shelf (编辑推荐 / 热门扩展面) — they are the
  # catalog's curated entries, and a fresh 4.1.0 host install must see them.
  api POST "/api/v1/admin/listings/$LISTING_ID/featured" '{"featured":true}' >/dev/null

  # ---- skip or abort on an existing same-version release ----------------------
  EXISTING=$(api GET "/api/v1/publisher/listings/$LISTING_ID/releases" | jq -r \
    --arg v "$VERSION" '.[] | select(.version == $v) | .status' | head -1)
  if [ -n "$EXISTING" ]; then
    if [ "$EXISTING" = "PUBLISHED" ]; then
      log "  version $VERSION already PUBLISHED — skipping"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    die "  version $VERSION already exists in state $EXISTING — resume or delete it in the publisher console"
  fi

  # ---- draft release + presigned upload ----------------------------------------
  DRAFT=$(api POST "/api/v1/publisher/listings/$LISTING_ID/releases" "$(jq -n \
    --arg v "$VERSION" --arg ch "$CHANNEL" --arg rh "$REQUIRES_HOST" \
    --arg cl "Official FengYu plugin release $VERSION" \
    '{version:$v, channel:$ch, requiresHost:(if $rh == "" then null else $rh end),
      license:"GPL-3.0", changelogMarkdown:$cl}')")
  RELEASE_ID=$(echo "$DRAFT" | jq -r '.releaseId // empty')
  [ -n "$RELEASE_ID" ] || die "  draft creation failed: $DRAFT"
  FINISHED=0
  trap 'if [ "$FINISHED" != 1 ] && [ -n "${RELEASE_ID:-}" ]; then
    printf "\033[1;33mwarn:\033[0m draft release %s left in %s — resume or delete it in the publisher console\n" "$RELEASE_ID" "$(api GET /api/v1/publisher/releases/$RELEASE_ID | jq -r .status)" >&2
  fi' EXIT

  SESSION=$(api POST "/api/v1/publisher/releases/$RELEASE_ID/uploads" "$(jq -n \
    --arg f "$BASENAME" --argjson s "$SIZE" \
    '{filename:$f, kind:"PACKAGE", platform:"universal", arch:"universal", size:$s}')")
  UPLOAD_URL=$(echo "$SESSION" | jq -r '.uploadUrl // empty')
  [ -n "$UPLOAD_URL" ] || die "  upload session failed: $SESSION"
  UPLOAD_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
    -H 'Content-Type: application/octet-stream' --data-binary "@$FILE" \
    "$STORE_BASE$UPLOAD_URL")
  [ "$UPLOAD_STATUS" = "204" ] || die "  PUT $BASENAME failed with $UPLOAD_STATUS"
  log "  uploaded ($((SIZE / 1024)) KiB, PACKAGE universal)"

  # ---- submit and wait out the async scan ---------------------------------------
  SUBMITTED=$(api POST "/api/v1/publisher/releases/$RELEASE_ID/submit")
  REVIEW_ID=$(echo "$SUBMITTED" | jq -r '.reviewId // empty')
  [ -n "$REVIEW_ID" ] || die "  submit failed: $SUBMITTED"
  log "  submitted — review $REVIEW_ID, waiting for the scan"
  DEADLINE=$((SECONDS + SCAN_TIMEOUT_SECONDS))
  while :; do
    REL=$(api GET "/api/v1/publisher/releases/$RELEASE_ID")
    STATE=$(echo "$REL" | jq -r '.status')
    case "$STATE" in
      IN_REVIEW) break ;;
      REJECTED|CHANGES_REQUESTED)
        echo "$REL" | jq -r '.findings[] | "    finding [\(.severity)] \(.rule): \(.message)"'
        die "  scan blocked $BASENAME (state $STATE) — force-publish is a human decision"
      ;;
    esac
    [ "$SECONDS" -lt "$DEADLINE" ] || die "  scan did not settle within ${SCAN_TIMEOUT_SECONDS}s (state $STATE)"
    sleep 2
  done
  log "  scan clean — release $STATE"

  # ---- approve (platform signature + PUBLISHED) ---------------------------------
  if [ "$APPROVE" = "1" ]; then
    DECISION=$(api POST "/api/v1/reviews/$REVIEW_ID/decisions" \
      '{"decision":"APPROVE","notes":"Official plugin publish pipeline"}')
    echo "$DECISION" | jq -e '.status == "APPROVED" // error("decision rejected: \(.)")' >/dev/null
    log "  approved — $NAMESPACE/$SLUG $VERSION is PUBLISHED (platform-signed)"
  else
    log "  STORE_APPROVE=0 — left IN_REVIEW for a human reviewer"
  fi
  FINISHED=1
  PUBLISHED=$((PUBLISHED + 1))
done

[ "$((PUBLISHED + SKIPPED))" -gt 0 ] || die "no .fyp packages found in $ASSETS_DIR"
log "done: $PUBLISHED published, $SKIPPED already current at $STORE_BASE"
