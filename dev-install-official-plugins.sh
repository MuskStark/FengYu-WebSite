#!/usr/bin/env bash
# Build every official plugin and stage the resulting .fyp + checksum pair into the
# official-plugin seeder directory.
#
# The official plugin SOURCES live in this repository (migrated from the FengYu main
# repo, release/4.1.0) but their toolchain does not: the fengyu CLI, the Java SDK/DevKit
# and the plugin UI kit stay in the main repo — independently versioned and published
# nowhere. This script therefore requires a sibling checkout of the main repository on
# the matching release branch:
#
#     FengYu-WebSite/   ← this repo: plugin sources + staging directory
#     FengYu/           ← main repo: toolchain (CLI, SDK, DevKit, UI kit)
#
# Official plugins are code-first contract projects: manifest.base.json + a Java worker
# contract (@FengYuRpc/@FengYuAiTool interfaces) compile into the packaged manifest during
# `fengyu build`, which itself runs the DevKit contract extraction through Maven
# generate-resources. That extraction resolves fengyu-plugin-sdk and fengyu-plugin-devkit
# from ~/.m2, and the plugin poms resolve fan.summer.fengyu:FengYu-parent from ~/.m2 as
# well (their <parent><version> is a LITERAL on purpose: ${revision} is never
# interpolated for repository-resolved parents), so this script installs the parent and
# the toolchain locally first, exactly like the CI plugin jobs.
#
# Official plugins (official:true / fan.summer.*) can ONLY be installed through the
# host-trusted seeder path (P0-8 anti-impersonation): the upload/marketplace API rejects
# them by design. The seeder scans fengyu.plugins.official-directory, whose IDE-dev
# default (<user.dir>/OfficialPlugins/target/packages) pointed into the MAIN repo before
# the migration — point it at this repo's staging directory instead (the script prints
# the exact -D flag at the end). The seeder verifies each .sha256 sidecar, upgrades
# newer versions, and refreshes same-version bundles whose bytes changed, so local
# "installation" = stage below + restart the host.
#
# Usage:
#   ./dev-install-official-plugins.sh [--skip-tests]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FENGYU="${FENGYU_ROOT:-$ROOT/../FengYu}"
SKIP_TESTS=0
OFFICIAL_PLUGINS=(markdown excel email offlinepython)
PACKAGE_DIR="$ROOT/OfficialPlugins/target/packages"
CLI="$FENGYU/toolchain/cli/bin/fengyu.mjs"

usage() {
  echo "Usage: $0 [--skip-tests]"
  echo
  echo "Builds all official plugins and stages them into $PACKAGE_DIR."
  echo "Restart the dev host afterwards — the official-plugin seeder installs"
  echo "them from that directory at startup (trusted path; uploads cannot do this)."
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1 (use --help for usage)"
      ;;
  esac
done

command -v node >/dev/null 2>&1 || fail "node is required"
command -v java >/dev/null 2>&1 || fail "java (JDK 21) is required for the worker contracts"
[[ -d "$FENGYU/toolchain" ]] \
  || fail "main repo not found: $FENGYU (set FENGYU_ROOT or place the checkouts side by side)"
[[ -f "$CLI" ]] || fail "plugin CLI not found: $CLI"
# Official plugin UIs install with Yarn 4 through corepack (Node >=25 dropped the
# bundled corepack — install it standalone there: `npm install -g corepack`).
command -v corepack >/dev/null 2>&1 \
  || fail "corepack is required (npm install -g corepack)"
corepack enable >/dev/null 2>&1 || true

# The SDK + DevKit live in ~/.m2 only: plugin workers resolve the SDK from their compile
# classpath and the DevKit contract processor through annotationProcessorPaths during the
# generate-resources phase that `fengyu build` runs. Install the FengYu parent first (the
# plugin poms reference it by literal version from ~/.m2), then the toolchain (same
# command as the CI plugin jobs); re-running after a toolchain bump refreshes ~/.m2.
echo
echo "Installing the FengYu parent + Java plugin toolchain (fengyu-plugin-sdk + fengyu-plugin-devkit) ..."
(cd "$FENGYU" && ./mvnw -B -N install -DskipTests)
(cd "$FENGYU" && ./mvnw -B -pl toolchain/sdk-java,toolchain/devkit-java -am install -DskipTests)

# Plugin UIs depend on @infinia/plugin-ui through a link: to the main repo's
# toolchain/ui, whose package entry resolves to ./dist/index.js — dist/ is gitignored,
# so build it when missing. Rebuild manually after editing the UI kit, or the plugins
# compile against a stale copy (symptom: UI typecheck fails with missing exports).
if [[ ! -f "$FENGYU/toolchain/ui/dist/index.js" ]]; then
  echo
  echo "Building the plugin UI kit (toolchain/ui/dist is not committed) ..."
  (cd "$FENGYU/toolchain/ui" && yarn install && yarn run build)
fi

# Aceternity components are machine-local (the license forbids committing their
# source files to this public repository). Restore the pinned FengYu-adapted
# variants when any plugin is missing its ui-src/src/aceternity/ directory.
MISSING_ACETERNITY=0
for plugin in "${OFFICIAL_PLUGINS[@]}"; do
  [[ -d "$ROOT/OfficialPlugins/plugin-$plugin/ui-src/src/aceternity" ]] || MISSING_ACETERNITY=1
done
if [[ "$MISSING_ACETERNITY" == "1" ]]; then
  echo
  echo "Restoring Aceternity components (absent on this checkout) ..."
  node "$ROOT/OfficialPlugins/scripts/restore-aceternity.mjs" --fengyu-root "$FENGYU"
fi

echo "Building ${#OFFICIAL_PLUGINS[@]} official plugins ..."
for plugin in "${OFFICIAL_PLUGINS[@]}"; do
  PLUGIN_DIR="$ROOT/OfficialPlugins/plugin-$plugin"
  # Code-first authoring source; rpc/aiTools/flowNodes/i18n come from the worker
  # contract and the manifest/ overlays, never from this file.
  [[ -f "$PLUGIN_DIR/manifest.base.json" ]] \
    || fail "code-first manifest not found: $PLUGIN_DIR/manifest.base.json"

  echo
  echo "==> Building $plugin"
  BUILD_ARGS=(build "$PLUGIN_DIR")
  if [[ "$SKIP_TESTS" == "1" ]]; then
    BUILD_ARGS+=(--skip-tests)
  fi
  node "$CLI" "${BUILD_ARGS[@]}"
done

mkdir -p "$PACKAGE_DIR"
shopt -s nullglob

echo
echo "Staging official plugins into $PACKAGE_DIR ..."
for plugin in "${OFFICIAL_PLUGINS[@]}"; do
  PLUGIN_DIR="$ROOT/OfficialPlugins/plugin-$plugin"
  MANIFEST_VALUES="$(node -e '
    const manifest = require(process.argv[1]);
    process.stdout.write(`${manifest.id}\t${manifest.version}`);
  ' "$PLUGIN_DIR/manifest.base.json")"
  IFS=$'\t' read -r PLUGIN_ID PLUGIN_VERSION <<< "$MANIFEST_VALUES"

  [[ "$PLUGIN_ID" == fan.summer.* ]] || fail "unexpected official plugin id: $PLUGIN_ID"
  ARCHIVE="$PLUGIN_DIR/dist/$PLUGIN_ID-$PLUGIN_VERSION.fyp"
  SIDECAR="$ARCHIVE.sha256"
  [[ -f "$ARCHIVE" ]] || fail "build output not found: $ARCHIVE"
  [[ -f "$SIDECAR" ]] || fail "checksum sidecar not found: $SIDECAR"

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$SIDECAR")")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$ARCHIVE")" && shasum -a 256 -c "$(basename "$SIDECAR")")
  else
    fail "neither sha256sum nor shasum is available"
  fi

  # Keep exactly the current development package for this id. The seeder keeps only the
  # highest version per id anyway, but an older same-version archive left here would
  # carry a stale checksum pair and could win the scan nondeterministically.
  STALE_PACKAGES=(
    "$PACKAGE_DIR/$PLUGIN_ID"-*.fyp
    "$PACKAGE_DIR/$PLUGIN_ID"-*.fyp.sha256
  )
  if [[ ${#STALE_PACKAGES[@]} -gt 0 ]]; then
    rm -f -- "${STALE_PACKAGES[@]}"
  fi

  cp "$ARCHIVE" "$SIDECAR" "$PACKAGE_DIR/"
  echo "==> Staged $PLUGIN_ID $PLUGIN_VERSION"
done

echo
echo "All official plugins were built and staged successfully."
echo
echo "To activate them:"
echo "  1. Restart your dev host (IDE run config) with the seeder pointed at THIS repo"
echo "     (the pre-migration default resolved into the main repo and no longer exists):"
echo "       -Dfengyu.plugins.official-directory=$PACKAGE_DIR"
echo "     At startup the seeder verifies each .sha256 sidecar and installs/upgrades/"
echo "     refreshes the staged packages through the trusted path."
echo "  2. The desktop shell is NOT affected by this directory — it points the seeder"
echo "     at its own bundled plugins directory via -Dfengyu.plugins.official-directory."
echo
echo "Note: a plugin you uninstalled in the host UI stays skipped while its uninstall"
echo "tombstone exists (<runtime data root>/manifest-digests/<id>.uninstalled); reinstall"
echo "it through the UI (or delete the tombstone) to let the seeder manage it again."
