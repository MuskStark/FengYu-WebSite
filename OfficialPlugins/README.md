# OfficialPlugins — FengYu official plugins (migrated)

The four FengYu official plugins **live in this repository**, migrated from the main
repository ([MuskStark/FengYu](https://github.com/MuskStark/FengYu), branch
`release/4.1.0`). The migration was executed on 2026-09-30; on 2026-10-07 the plugins
were upgraded onto the unified **toolchain 2.1.x** line (sdk-java/devkit-java/sdk-ts/
ui/dev/cli in lockstep, worker protocol v4) and verified end-to-end: Maven reactor
build with all tests green, and `fengyu build` producing all four `.fyp` packages
from this location.

| module                 | plugin id                 | version       |
|------------------------|---------------------------|---------------|
| `plugin-email`         | `fan.summer.email`        | 4.1.0-alpha.1 |
| `plugin-excel`         | `fan.summer.excel`        | 4.1.0-alpha.1 |
| `plugin-markdown`      | `fan.summer.markdown`     | 4.1.0-alpha.1 |
| `plugin-offlinepython` | `fan.summer.offlinepython`| 4.1.0-alpha.1 |

## Layout & invariants

- `plugin-*/` — sources moved verbatim: Java worker + tests, `ui-src/` (Yarn 4 UI),
  `manifest.base.json`, the committed generated contracts (drift-checked by
  `fengyu check`). Build output (`dist/`, `dist-package/`, `target/`) is gitignored.
- `plugin-*/ui-src/src/aceternity/` — machine-local vendored Aceternity components
  (see "Aceternity components" below); gitignored, never committed.
- `scripts/restore-aceternity.mjs` — restores the components above from a pinned
  FengYu commit (run automatically by `dev-install-official-plugins.sh` when absent).
- `pom.xml` — standalone aggregator on the FengYu toolchain line. It is **not** a module
  of the store reactor and must never become one: different groupId, version line and
  dependencyManagement than `dev.infinia.store:infinia-store-parent`.

## What changed during the move (and why)

1. **Parent poms resolve from `~/.m2` with a LITERAL version.** The plugins kept
   `fan.summer.fengyu:FengYu-parent` but with `<relativePath/>` and
   `<version>4.1.0-alpha.1</version>` instead of `${revision}` + `../../pom.xml`.
   `${revision}` in a repository-resolved `<parent><version>` is never interpolated —
   not even with an explicit `-Drevision` on the command line — it only ever worked in
   the main repo via raw-text relativePath matching plus the root `.mvn/maven.config`.
   The installed parent pom carries its own `revision` property, so inherited values
   (`${fengyu.plugin.sdk.version}` = 3.0.0, dependency versions) still resolve.
2. **`ui-src` link: dependencies repointed at the sibling checkout.**
   `@infinia/plugin-sdk` / `@infinia/plugin-ui` / `@infinia/plugin-dev` are
   `link:../../../../FengYu/toolchain/{sdk-ts,ui,dev}` now, and every `ui-src/yarn.lock`
   was regenerated to match (the CLI installs with `--immutable`). Same sibling-checkout
   convention as `store-web/scripts/sync-docs.mjs`.
3. **`dev-install-official-plugins.sh` was ported to this repo's root** (staging dir is
   now `<this repo>/OfficialPlugins/target/packages`; toolchain + CLI + UI kit come from
   `../FengYu`, overridable via `FENGYU_ROOT`).

## Prerequisites per machine / CI job

A sibling checkout of the main repo on the matching branch, then:

```bash
(cd ../FengYu && ./mvnw -B -N install -DskipTests)          # FengYu-parent pom
(cd ../FengYu && ./mvnw -B -pl toolchain/sdk-java,toolchain/devkit-java -am install -DskipTests)
(cd ../FengYu/toolchain/ui && yarn install && yarn run build)  # only if dist/ is missing
```

Or just run `./dev-install-official-plugins.sh [--skip-tests]`, which does all of the
above, builds the four plugins via the CLI, and stages the `.fyp` + `.sha256` pairs.

## Build commands

```bash
cd OfficialPlugins && ../mvnw -B package     # Java side: contract extraction, tests, shaded workers
node ../FengYu/toolchain/cli/bin/fengyu.mjs build OfficialPlugins/plugin-markdown  # full .fyp package
```

## Host activation (seeder path)

Official (`fan.summer.*`) plugins can ONLY enter the host through the trusted seeder
directory — the upload/marketplace API rejects them by design (P0-8). The host's
`fengyu.plugins.official-directory` IDE-dev default resolves to
`<user.dir>/OfficialPlugins/target/packages`, which pointed into the **main** repo before
the migration and no longer exists there. Point it here instead:

```
-Dfengyu.plugins.official-directory=<this repo>/OfficialPlugins/target/packages
```

## Version bumps (host line moves, e.g. 4.1.0-beta.1)

1. Update the four `plugin-*/pom.xml` + `OfficialPlugins/pom.xml` parent `<version>`
   literals and the `version` in each `manifest.base.json`.
2. Reinstall the parent from the bumped main-repo checkout (`./mvnw -N install`).
3. `ui-src` link paths stay untouched (they point at toolchain dirs, not versions).

## Toolchain line bumps (e.g. 2.1.x → 2.2.0)

Each `plugin-*/pom.xml` pins `<fengyu.plugin.sdk.version>` (currently **2.1.0**)
because the repo-resolved FengYu-parent still manages the pre-unification `3.0.0`
in that property — the child override re-interpolates both the versionless Worker
SDK dependency and the DevKit contract processor. A toolchain bump is: bump the four
pom properties, `./dev-install-official-plugins.sh` (reinstalls the toolchain into
`~/.m2`, rebuilds `toolchain/ui/dist` when missing), and re-verify the
`backend.protocolVersion` constant in `manifest.base.json` still matches the CLI's
`manifest.schema.json`.

## Aceternity components

Toolchain 2.1.x stopped shipping Aceternity components inside `@infinia/plugin-ui`
(the Aceternity license forbids redistributing their source files, and this
repository is public). Each plugin that uses them vendors machine-local copies under
`ui-src/src/aceternity/` — gitignored together with the `.fengyu-aceternity-ack`
marker — and imports them via relative paths. The variants in use are the
**FengYu-adapted** ones (e.g. `card-spotlight` without the three.js
`CanvasRevealEffect` layer: "plugin iframe bundles must stay small"), restored by
`scripts/restore-aceternity.mjs` from the pinned FengYu commit `a407471a`.
`dev-install-official-plugins.sh` runs the restore automatically when the directory
is absent. Fetching fresh upstream variants instead is `fengyu add <slug> --yes`
(heavier: the upstream `card-spotlight` pulls `three` + `@react-three/fiber`).

## Not moved (deliberately)

- **`toolchain/`** (SDK, DevKit, CLI, UI kit) — stays in the main repo, version-locked
  to the host and published nowhere.
- **Plugin docs** (`docs/{en,zh}/plugins/official-*.md`) — still sync into the website
  from `../FengYu/docs` via `store-web/scripts/sync-docs.mjs`. Moving them here means
  teaching sync-docs a second source root.

## Store distribution (automatic publishing)

The store is the ONLY production distribution channel for official plugins (the
host never bundles or seeds them; its P0-8 trust rule admits `fan.summer.*`
installs only when the artifact carries the store's platform Ed25519
signature). Publishing is a one-command, idempotent flow:

```bash
./dev-install-official-plugins.sh                       # build + stage dist/*.fyp
node scripts/publish-official-plugins.mjs               # publish new versions
```

The script compares each `manifest.base.json` version against the store's
published releases (`GET /api/v1/admin/plugin-releases`, any channel) and
publishes whatever is new through `/api/v1/admin/plugin-releases`
(AdminPluginReleaseController — the same intranet admin path the host-app
releases use: ensure-listing, ticketed upload, immediate publish; the publish
step mints the platform signature). Already-published versions are skipped,
downgrades are refused, and stale DRAFTs from an interrupted run are cleaned
up automatically. Credentials: `STORE_API_BASE`, `STORE_ADMIN_EMAIL`,
`STORE_ADMIN_PASSWORD` (a PLATFORM_ADMIN account). `--dry-run` prints the plan;
`--plugins markdown,email` narrows the set.

Channel semantics: the version's pre-release suffix names the store channel
(`4.1.0-alpha.1` → alpha). Only STABLE releases enter the host's compat catalog
(`/api/v1/compat/fengyu/catalog`) — same posture as the host-app update feed —
so a pre-release version is published and downloadable but deliberately absent
from that feed until the line goes stable.

Automation: `.github/workflows/official-plugins-publish.yml` runs the same two
commands on every push to main that touches a `manifest.base.json` (and on
manual dispatch). One-time setup: the `STORE_API_BASE` / `STORE_ADMIN_EMAIL` /
`STORE_ADMIN_PASSWORD` repository secrets. Without them the job skips with a
notice and CI behaves exactly as before.

The `fan.summer` namespace (note: dotted, allowed by InfiniaCoordinate) and the
four conventional listings are created automatically on first publish.

## Known follow-ups

- ~~FengYu CI references `OfficialPlugins/` paths~~ — **resolved**: FengYu's CI was
  reworked to build a committed smoke-fixture plugin instead (no OfficialPlugins
  references anywhere in that repo), and this repository now carries
  `.github/workflows/official-plugins-ci.yml`, which checks out the FengYu
  `release/4.1.0` toolchain as a sibling and runs `dev-install-official-plugins.sh`
  (tests included) on `OfficialPlugins/**` changes.
- The plugin docs' "edit this page" links still point at the main repo.
