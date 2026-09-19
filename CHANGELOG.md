# Changelog

## Unreleased

### fix(assets): dedicated-domain monitor publishes; fail-closed shared-tree mirror

- `deploy-assets.sh --monitor` now actually supports the dedicated
  Pages-project-per-SPA layout its docs promised: a bare-domain
  `ASSETS_BASE_URL` (e.g. `https://status-assets.infinia.fyi`) publishes the
  dist as-is at the project root — no `/monitor` subtree staging, no shared
  `_headers`, no mirroring. Previously every monitor publish was forced into
  the shared-subtree staging, so running the script against a dedicated
  domain would have replaced its root layout with a broken `/monitor` tree
  (the jar's shell references `/assets/*` at the root). The layout is picked
  from the base URL's shape; a domain with any path other than `/monitor`
  fails fast instead of guessing.
- The shared-layout mirror can no longer be fooled by the Pages SPA fallback.
  A missing half answers `200 text/html` (the root SPA's shell), which the
  old code "mirrored" as if it were the real half — silently republishing
  store-only trees; that is how `status.infinia.fyi` ended up loading its
  bundle from an HTML fallback (blank page: the module MIME check rejects
  it). The fetched shell is now validated against that half's real asset
  URLs: an absent monitor half downgrades to a warning (the steady state
  once the monitor has its own assets domain), an absent or unrecognizable
  store half is fatal, and once a half is confirmed live, any failure to
  copy one of its files aborts the publish instead of dropping the half.
- Mirroring the store half now copies a COMPLETE half: hashed SPAs lazy-load
  route chunks via `import("./View-x.js")` and `__vite__mapDeps` entries
  (`"assets/…"` — where per-route CSS files only ever appear), none of which
  the HTML shell references. The old shell-only mirror would have restored a
  store half missing ~35 of its 36 JS files. Discovered refs are fetched
  recursively to closure; refs that 404 (a quoted string in minified code
  can look like a path without being one) only warn and skip.

### fix(deploy): first-boot upstream sync no longer rolls back every upgrade

- The initial upstream catalog index ran as a synchronous
  ApplicationReadyEvent listener, and `/actuator/health` answered 503 until
  it returned — on a cold catalog that is 5-6 minutes of failing
  healthchecks, so `upgrade.sh`'s health gate rolled back every deploy (and
  the rolled-back container then failed the same way). The bootstrap now
  uses `UpstreamSyncService.startBackgroundSync` (background executor,
  in-flight dedup, run row visible in the admin UI); the app reports healthy
  seconds after boot while the import continues in the background. The
  hourly failed-source retry rides the same change and no longer blocks the
  scheduler thread.
- Defense in depth: Docker HEALTHCHECK `--start-period` 90s->5m and
  `--timeout` 5s->10s; `upgrade.sh` / `deploy.sh` only treat *unhealthy* as
  fatal after 420s (was 120s) and give the store a 900s health budget
  (was 600s).

### Optional: SPA static assets served from Cloudflare Pages (first-visit 522 fix)

- Production (www.infinia.fyi behind Cloudflare) intermittently returned 522 on
  first-visit `/assets/**` loads: the zone's cache rules bypass the cache for
  static files, so every hashed asset was a live edge→origin fetch across a
  flaky cross-border link. The opt-in fix offloads those files to a Cloudflare
  Pages project bound to a dedicated assets domain; Pages serves `/assets/*`
  with a year of immutable caching and never touches the origin. Free plan,
  unlimited static requests/bandwidth.
- Mechanics: `ASSETS_BASE_URL` (server `.env`, set by the script itself) sets
  the Vite `base`, so the shell references e.g.
  `https://assets.infinia.fyi/assets/index-x.js`; unset it keeps assets
  same-origin and every existing deployment byte-identical. No CI involvement:
  the store host is the single publishing source — `scripts/upgrade.sh`
  re-publishes the new jar's SPA to Pages after every successful deploy while
  the offload is active (`ASSETS_BASE_URL` in `.env` + `deploy.conf` present). A `public/_headers`
  file ships CORS (`Access-Control-Allow-Origin: *`) for module scripts,
  dynamic imports and font loads from the cross-origin shell. Publishes are
  additive — old hashed files stay, so rollbacks keep resolving.
- Full runbook: DEPLOYMENT.md "Static assets on Cloudflare Pages";
  `scripts/deploy-assets.sh --all` is the one-command end-to-end path:
  interactive configure (saved to deploy.conf) → build & publish (store host:
  extracted from the freshly built image's jar; elsewhere: container build
  from the same lockfile) → attach the custom domain via the Cloudflare API
  (no dashboard click needed) → wait until the domain serves the files →
  switch the store container → health wait. Plain `--switch` (wait + cut
  over), `--dist <dir>` (publish-only) and `--configure` (questionnaire only)
  remain for step-by-step use.
- The same offload covers the monitor SPA: `scripts/deploy-assets.sh
  --monitor [--all]` (auto-detected on a monitor-only host), staged by
  default as a /monitor subtree of the SAME Pages project/domain as the
  store (e.g. https://asset.example.com/monitor on project infinia-assets;
  a dedicated project/domain per SPA stays possible via deploy.conf). Every
  publish carries a shared root _headers with CORS for both path prefixes.
  monitor-web gains the identical `ASSETS_BASE_URL` base support and a
  `public/_headers`; `Dockerfile.monitor` takes the build arg;
  `upgrade.sh --monitor` bakes the origin into its build and re-publishes
  after every successful deploy. NB: the GHCR image stays same-origin — an
  offloaded monitor builds locally (the script writes the build override).
  Setting `base` explicitly rotates chunk filenames once (byte-identical
  content), so every jar built after this change references new hashes.

### Interactive deploy scripts + `deploy.conf`

- `deploy.sh` / `deploy-assets.sh` read optional KEY=VALUE settings from a
  gitignored `deploy.conf` at the repo root (documented in DEPLOYMENT.md).
  Precedence: flags > environment variables > deploy.conf > defaults, so
  scripted environments stay unaffected. Keys cover both hosts: STORE_BASE_URL,
  MONITOR_TARGET_BASE_URL, MONITOR_ALERT_WEBHOOK, MONITOR_IMAGE_REGISTRY/TAG,
  APT_MIRROR, REGISTRY_MIRRORS, and the Pages set (ASSETS_BASE_URL,
  ASSETS_PAGES_PROJECT, CLOUDFLARE_ACCOUNT_ID/API_TOKEN, NPM_CONFIG_REGISTRY,
  NODE_IMAGE).
- Interactive on a terminal: `deploy.sh` asks store-vs-monitor-host whenever
  the flags don't imply it (monitor-only flags such as `--target-url` select
  the monitor host; a box already running the standalone monitor is
  preselected; store/监控 answers accepted) and asks for required values;
  `upgrade.sh` auto-detects monitor-only hosts the same way; `deploy-assets.sh` asks for missing Cloudflare/Pages values
  and offers to save them to deploy.conf (mode 600). `--configure` runs only
  the questionnaire — pipeable for scripted pre-provisioning. Unattended runs
  fail fast with fix hints instead of prompting.
- Fixed en route: `deploy.sh`'s sudo re-exec dropped all flags (the parse loop
  had already consumed `$@`); it now replays ORIGINAL_ARGS.

### scripts/ consolidated: one script per lifecycle concern

- `scripts/deploy.sh` now bootstraps either host — the store stack by default,
  the standalone monitor with `--monitor-host` (absorbs
  `deploy-monitor.sh`; ~200 lines of duplicated host preparation collapsed).
- `scripts/upgrade.sh` now upgrades either host — the store by default, the
  monitor with `--monitor` (absorbs `upgrade-monitor.sh`; Jenkins' stdin
  invocation `git show <sha>:scripts/upgrade.sh | sudo bash -s -- --monitor …`
  keeps working via the `--path` option).
- `scripts/deploy-assets.sh` absorbs `publish-assets.sh` (`--dist <dir>`
  publish-only mode); asset publishing runs on the store host (bootstrap via
  `--all`, then automatically from `scripts/upgrade.sh`), never in CI.
- Unchanged on purpose: `backup-stack.sh` (cron-invoked),
  `export-store-trust.py` (different runtime, Jenkins),
  `publish-app-release.sh` (store API client tool). Call sites updated:
  `ci.yml`, `Jenkinsfile`, `docker-compose.monitor.yml`, DEPLOYMENT.md.

### One service, both faces: the store service is now **InfiniaWebService**

- The deployable store service is formally renamed **InfiniaWebService** — the name
  now says what it does: one origin serving every web surface of the platform.
  `spring.application.name` is `InfiniaWebService`, the executable jar builds as
  `InfiniaWebService-<version>.jar` (module `store-application` keeps its Maven
  coordinates), and the production Docker image / rollback tags become
  `infinia-webservice` (`docker-compose.yml`, `scripts/upgrade.sh`, DEPLOYMENT.md).
- The official website is now served by InfiniaWebService itself: `build-jar.sh`
  builds the site's Next.js static export (`yarn workspace @infinia/website
  build:export` with `NEXT_PUBLIC_BASE_PATH=/site`) and embeds it under
  `classpath:/static/site`, next to the store SPA. One jar, one port:
  `/` → store SPA, `/site` → official website, `/api/v1` + OAuth — the build
  script verifies both shells are actually inside the archive before calling it
  a release.
- Serving details: `/site` redirects to `/site/`, the website shell is forwarded
  like the SPA shell (same revalidate-always `Cache-Control` via the
  no-cache filter), and content-hashed `/site/_next/static/**` assets cache for
  a year — mirroring the SPA's `/assets/**` contract. The embedded export builds
  with `NEXT_PUBLIC_STORE_URL=/`, so the site's store entrance stays same-origin.
- The standalone website workflow is unchanged (`yarn website` on :3100); the
  Dockerfile web stage builds both frontends, and the Jenkins gate gained
  `yarn website:build`.

### Official Infinia website merged into the repository as the `website` workspace

- The official website of Infinia (蜂语 / FengYu) now lives in this repository as a
  standalone Next.js 15 workspace (`website/`, port 3100, root scripts `yarn website` /
  `yarn website:build`) — one checkout, one `yarn install`, no more cross-repo drift
  between the site and the store platform. It still builds and runs fully independently
  of the Maven host build and the store SPA (no shared code).
- The site is built strictly from Aceternity UI registry components (`ui.aceternity.com`),
  copied verbatim with per-file provenance comments into `website/src/components/ui/`;
  registry keyframes are ported to Tailwind CSS 4 `@theme` tokens. The only documented
  adaptations are a configurable CTA prop on the floating navbar and React 19
  type-compat fixes.
- Copy is English-first with a 简体中文 switch, mirroring the store SPA; all product
  facts (surfaces, plugins, loopback security, download variants) describe the FengYu
  host distributed through this store.
- The homepage now opens onto the store: navbar pill, hero CTA and footer link all
  point at the store application (`NEXT_PUBLIC_STORE_URL`, default
  `http://localhost:8080`).

### Store SPA rewritten on React with original Magic UI components (ADR-013)

- The store-web frontend now runs React 19 + TypeScript + Vite 7 + Tailwind
  CSS 4 and consumes Magic UI components copied verbatim from the official
  registry (`magicui.design/r/*.json`) — MagicCard, BorderBeam,
  AnimatedGridPattern, Marquee, ShimmerButton, BlurFade, NumberTicker,
  AnimatedList, plus the shadcn/ui base badge and progress Magic UI builds on.
  The hand-maintained `@infinia/magic-ui-vue` port is deleted (supersedes
  ADR-007): no more per-release porting drift, upstream refresh = re-copy.
- The store's design language is unchanged: marketplace tokens, the
  JetBrains-brand hero gradient, the honeycomb brand wall and bee level
  crests all carry over, with the shadcn base tokens (`--color-background`,
  `--color-border`, …) mapped onto the store palette so original components
  render with the marketplace look.
- Ecosystem swaps with identical behavior: Pinia → Zustand (same store
  shapes), vue-router → React Router (same routes and role guards),
  vue-i18n → react-i18next (same dictionaries; `{x}` placeholders and pipe
  plurals render byte-identically), theme toggle via next-themes on the same
  `infinia.store.theme` storage key. The 15-file test suite is ported to
  React Testing Library (63 tests) and the Jenkins gate runs
  `yarn web:test` / `yarn web:build` as before.

### Public platform trust anchors: `GET /api/v1/platform-keys`

- The ACTIVE platform signing keys are now served anonymously as
  `{keys:[{keyId, algorithm, publicKeyBase64, validFrom, validTo}]}` —
  `publicKeyBase64` is the exact Base64 X.509 DER encoding the FengYu host's
  operator overlay `trusted-store-keys.json` expects verbatim. Public keys
  are public (JWKS precedent) and the private half never leaves KMS/HSM
  (ADR-006), so the store itself can be the anchor bootstrap channel.
- Closes the provisioning gap for strict-posture host installs
  (`fengyu.store.require-signature=true`): operators fetch the anchor from
  the store instead of hand-querying the `signing_key` table. Verified
  end-to-end against a fresh local store — without the anchor the host
  refuses the download at the signature gate; with it, plugin and skill
  installs verify the Ed25519 signature over the downloaded bytes.

### Publisher center: step-by-step wizard, package autofill, status board, release deletion

- The Publishing Center is now a focused 3-step wizard in one centered card —
  ① select or create a listing → ② create or resume a release → ③ upload &
  submit. Steps unlock in order (walk back any time), drafts resume straight
  at the upload step, and the Infinia Level gate moved to the listing detail
  page so publishing stays a single-purpose flow.
- Creating a listing can read the basics straight from the `.fyp` package:
  drop the plugin into step ① and name / slug / summary / type (plus the
  release version and host range for step ②) are prefilled from its
  `manifest.json` — the hand-typed version mismatch class of rejections is
  gone. Client-side parse via `fflate` with host-contract validation and
  distinct error reasons.
- Step ① groups listings by where their flow stands — 需要处理 (draft /
  rejected / changes requested), 流程中 (scanning / in review), 已发布,
  暂无版本 — each card carrying the focus release's status chip and version,
  refreshed whenever the wizard returns to step ①.
- Publishers can delete an abandoned unpublished release (draft, rejected,
  changes requested, in review) from step ③ — `DELETE
  /api/v1/publisher/releases/{id}`, owner-only, hard delete with the
  RELEASE_DELETED outbox event and audit trail. Published / withdrawn
  releases refuse deletion (409); withdrawing stays an admin action.

### PLATFORM_ADMIN may decide their own releases

- The self-review guard ("Reviewers cannot review their own releases") now
  exempts platform admins — the same trust root the admin force-publish and
  admin-upload paths already use. Ordinary reviewers keep the guard; the
  decision is still audited under the admin's own id.

### Scanner: archive-size cap fix + full FengYu host-rule mirror

- Fixed a rejection loop: the disk-backed scan entry applied the 16 MiB
  non-archive-template read-back cap to every non-SKILL type, so plugin
  `.fyp` packages between 16 and 100 MB were always rejected as
  `scanner.file-too-large`. Archives (PLUGIN/FLOW) are now capped at the
  host's 100 MB package limit, SKILL keeps its streaming scan with the
  host's 10/50 MB ceilings, and MCP templates stay at 16 MiB.
- `FengYuHostRules` now mirrors the host's current grammar: npm-style engine
  ranges (`^4.1.0`, `~4.1.2`, `4.x`, `1.2.x`, `*`, bare partials) are
  accepted (the host added them in its P3 batch; the store used to reject
  packages the host installs fine), and the manifest mirror gained the
  backend install-time contract — worker artifact presence,
  `protocolVersion`, timeout/resource ceilings, non-empty `rpc.methods`
  with OBJECT schemas, AI-tool method references and `effect` metadata,
  1 MB manifest cap and strict SemVer version format.

### Upstream sync runs in the background with a visible state

- Registering an upstream no longer blocks the request for the whole first
  aggregation (minutes): the run opens on a dedicated executor and the create
  response returns immediately with `syncStatus=SYNCING`. "Sync now" (POST
  `…/sync`) does the same and answers `202`. A second run on a source whose
  latest run is still RUNNING is refused in favor of the open one, so
  registration and manual triggers cannot pile up concurrent runs.
- The admin console shows one status line per source — 正在同步… / 同步成功 /
  同步失败 with imported·skipped·failed counts — refreshed by a poll while any
  run is open, and the raw error blob moved off the card into a new sync-log
  dialog (`GET /api/v1/admin/upstreams/{id}/sync-runs`, latest 20 runs with
  per-run timings, counts and one error per line).
- `Upstream` DTO/contract gained `syncStatus`, `lastRunStartedAt` and
  `lastRun{Imported,Skipped,Failed}`; `UpstreamSyncRun` is new. Stored run
  errors are newline-joined (legacy `"; "` rows still render), and
  `V14__sync_run_source_index.sql` indexes `sync_run (source_id, started_at)`
  for the new queries.

### Sign-in navigation hardening

- Sign-in now adopts the user carried by the login/register response and
  navigates immediately instead of waiting on a second `/api/v1/me` round-trip
  that could leave the form looking dead; if the SPA navigation itself fails
  (stale shell after a redeploy), a full page load takes the user to the
  redirect target instead of stranding them on the sign-in page.
- The SPA entry script carries `data-cfasync="false"` so Cloudflare Rocket
  Loader stops rewriting `type="module"` into its own loader (a known SPA
  breaker). Disabling Rocket Loader for the zone remains the cleaner fix.

### Automated production deploys (CI → SSH)

- `ci.yml` gained a `deploy` job: after `backend`/`frontend`/`images` are
  green on a push to `main` (or a manual *Run workflow* dispatch), it SSHes
  into the production host and runs the new `scripts/upgrade.sh` pinned to
  the exact commit — fetch, checkout, `docker compose --profile app up -d
  --build`, health wait, and an automatic rollback to the previous image and
  checkout when the store does not come back healthy. Deploys queue behind
  each other (never cancel mid-deploy) and appear under *Environments →
  production*; the optional monitor host (split deployment) updates by GHCR
  image pull in the same run.
- Everything is opt-in via repository secrets (`DEPLOY_SSH_HOST` +
  `DEPLOY_SSH_PRIVATE_KEY` at minimum); without them the job prints a notice
  and CI behaves exactly as before. One-time setup, rollback commands and a
  NAT-safe server-side polling alternative live in DEPLOYMENT.md
  "Automated deploys".
- A self-hosted alternative ships as a root `Jenkinsfile`: the same backend
  verify + frontend tests/builds run in stage containers (the agent needs
  only Docker), and a green `main` build deploys through the same
  `scripts/upgrade.sh` — over SSH, or locally when Jenkins shares the
  production host. The GitHub Actions deploy and the Jenkins pipeline
  coexist; setup notes in DEPLOYMENT.md "Automated deploys".

### Direct web download of offline install packages

- New anonymous endpoint `GET /api/v1/releases/{id}/install-package` streams
  one ZIP per release: the Native install manifest
  (`install-manifest.json`, same contract as `/install-manifest` plus a
  `package` layout block and the in-package artifact filename), the signed
  artifact under `artifact/`, and a `sha256sum -c` compatible
  `checksums.txt`. The downloaded file installs through the host's local
  install mode (主程序本地安装) with full provenance — sha256, Ed25519
  signature and key id travel inside the manifest — and no store connection
  is required at install time (aggregation plan §5.2 `RAW_ARTIFACT` rule).
- Infinia Level gates, installable-status checks and upstream
  materialization run before any bytes are served: gated listings answer
  `bee_level_required`, DRAFT releases answer `invalid_state_transition`,
  and legacy virtual `upstream/` artifacts are stored and platform-signed
  first, so a package never ships digest-less bytes. Completed package
  downloads count toward the listing's download counter.
- The listing page keeps a single Get CTA: the permission-aware
  resolve → confirm machine (design §9.2/§12.6) now ends by downloading the
  offline install package itself — the old simulated install, its raw-ticket
  download link and the duplicate 下载安装包 rail button are gone. The
  versions tab keeps per-release package downloads; download failures name
  the download instead of blaming resolution, and the done state points at
  the host's local install mode (主程序本地安装). Backed by the new
  `api.download` helper, which streams the response as a Blob and keeps the
  server-side filename from `Content-Disposition`; APP listings keep their
  platform-detected binary download.
- Contract: the operation ships in `openapi.yaml` with regenerated
  `schema.d.ts` types; InstallPackageDownloadTest covers the ZIP layout,
  digest/signature propagation, the three install modes
  (PLUGIN_PACKAGE / SKILL_DIRECTORY / MCP_TEMPLATE stays disabled with
  LOCAL_ONLY secrets), draft rejection and the bee-level gate.

### The footer's service-status link goes to the monitor page, not raw JSON

- The SPA's `/status` deep link now reads the monitor's public address at
  runtime from the new anonymous endpoint `GET /api/v1/status/monitor`
  (backed by `STORE_MONITOR_PUBLIC_URL`), so prebuilt images redirect to the
  deployment's status page without a rebuild; the build-time
  `VITE_MONITOR_BASE_URL` stays as a fallback.
- Previously an unconfigured deployment silently redirected users to the
  `/api/v1/status` JSON payload. Now it degrades to a friendly bilingual
  notice naming the missing setting instead.

### A failing optional upstream no longer keeps the page yellow

- Failed upstream syncs retry hourly (`store.upstream.retry-interval-ms`):
  previously one failure degraded the status page's upstream component until
  the next reboot, so a transient upstream outage (a 503, a network blip)
  painted the whole page yellow while the store itself was healthy.
- New runtime toggle: `PATCH /api/v1/admin/upstreams/{id}` with
  `{"enabled": false}` parks a persistently failing source — the probe skips
  disabled sources, turning the page green again without a reboot.
  UpstreamAdminToggleTest covers failing-source → degraded → disable →
  green end to end; the contract and generated types ship the operation.

### Status-page uptime semantics (full coloring audit)

- Degraded samples now count as availability (the statuspage.io convention,
  mirrored between the store's own history and the monitor's external
  component): only down samples reduce the uptime percentage, so a sub-100%
  day can only ever appear orange/red — never again "0.00% uptime" colored
  yellow, the confusing combination a day of pure degraded probes produced
  (e.g. while the default upstream sync was failing).
- Day uptimePercent is rounded to one decimal like uptime90d (it previously
  leaked a raw double such as 33.333333333333336).
- Component names audited: all 11 store components + the monitor's external
  reachability carry localized names in both locales with no gaps;
  "上游同步 / Upstream sync" is accurate for what it measures (upstream
  aggregation health).

### Upstream aggregation works without seeding

- Production boots with the default SkillHub upstream enabled but seeds
  nothing, so the first sync aborted with "CI publisher account missing
  (seed required)" and the status page showed the source permanently
  degraded. The sync now provisions its internal machine accounts
  (ci/reviewer) itself — credential-less rows that can never log in
  interactively; they exist purely as ownership and audit anchors. New
  UpstreamSyncProvisionsInternalAccountsTest covers the empty-deployment
  bootstrap end to end.
- The compose store service passes `STORE_UPSTREAM_DEFAULTS_ENABLED` /
  `STORE_UPSTREAM_SKILLHUB_URL` through (default on), so a deployment can
  disable or retarget the default mirror from `.env`.

### Production SPA cache policy & demo-account removal

- Navigation "silently dead after an upgrade": the SPA's index.html carried no
  Cache-Control, so browsers heuristic-cached the shell across deployments —
  a stale shell references content-hashed chunks the upgraded server no
  longer has, lazy-route loads 404 and every nav click is cancelled. A
  DefaultNoCacheFilter (REQUEST/FORWARD/ERROR dispatches) now defaults every
  GET/HEAD to revalidate-always; /assets/** keep their one-year immutable
  cache. Same filter in the monitor for its embedded SPA. The welcome page is
  served through an explicit forward:/index.html so it passes the filter.
- The sign-in demo-accounts panel is now dev-only (`import.meta.env.DEV`):
  production seeds nothing, and the credentials no longer ship in the
  production bundle at all (emails, password and the hint text all moved
  behind the DEV constant or reworded).

### Test-suite determinism

- Every `@SpringBootTest` class now runs against its own fresh H2 database
  (ContextCustomizerFactory; classes that pin their own
  `spring.datasource.url` are untouched). Previously the suite shared one
  in-memory database, so classes mutating seeded state — the app-release
  flow publishing newer versions of the seeded listing, the SSRF test's
  failed-sync upstream — made results depend on surefire's class order,
  which differs between machines and even between CI checkouts. Reproduced
  in a fresh-clone Linux container; isolation makes cross-class pollution
  structurally impossible (store-application suite ~40s slower, every class
  boots its own context).

### Split deployment: monitor on its own host

- `docker-compose.monitor.yml` runs the standalone status monitor on a
  dedicated server (ADR-011: the status page must survive a store outage):
  GHCR image pull — no build toolchain on that host — own volume, all-interface
  8090 by default, `MONITOR_TARGET_BASE_URL` mandatory (prefer the store's
  public URL through the WAF so the monitor measures true external
  reachability; `MONITOR_IMAGE_TAG` pins the image). `MONITOR_IMAGE_REGISTRY`
  swaps in a GHCR proxy (e.g. ghcr.m.daocloud.io) for networks without direct
  ghcr.io access.
- `scripts/deploy-monitor.sh` is the monitor host's one-click counterpart of
  deploy.sh: Docker install, apt/registry mirrors, `.env` generation
  (target URL mandatory), image pull with clear guidance when ghcr.io is
  unreachable, `--build` to compile locally instead, health wait, and a
  reachability probe of the store from that host — the #1 misconfiguration.
- The co-located monitor moved from the `app` profile to a `monitor` profile,
  so `--profile app` on the store host brings up the store only; single-host
  installs add `--profile monitor`. `scripts/deploy.sh` follows suit
  (store-only by default, `--with-monitor` for single-host) and prints the
  monitor-host bootstrap. DEPLOYMENT.md carries the two-host topology, site
  table and per-host upgrade commands.

### First-user admin bootstrap & split-host publishing

- The first account registered on an empty deployment is granted
  PLATFORM_ADMIN automatically — production seeds nothing by design (demo
  credentials are public and refused outside dev profiles), so this is the
  admin bootstrap path; later registrations keep the plain USER role and the
  admin assigns roles/levels/status per account from the existing user
  console. Documented in DEPLOYMENT.md "First admin".
- The app ports publish on all interfaces by default (direct access for a
  WAF on a separate host or LAN clients): `STORE_BIND_HOST` /
  `MONITOR_BIND_HOST` rebind them — 127.0.0.1 restores loopback-only for a
  co-located proxy. Dependency-plane ports (PostgreSQL/MinIO/Redis) stay
  loopback-bound; DEPLOYMENT.md carries the DOCKER-USER firewall recipe
  (plain ufw does not filter Docker-published ports).

### CI repair on main

- `Dockerfile.monitor` builds again: the root POM's reactor refuses to parse
  unless every declared module directory exists in the build context, so the
  four modules the monitor never compiles (`store-domain`,
  `store-infrastructure`, `store-scanner`, `store-application`) are present as
  POM-only copies; `-pl store-monitor -am` still builds only
  contract+monitor.
- `ServiceStatusTest` is deterministic regardless of test-class execution
  order: it asserts fresh-boot behavior (all components operational, empty
  incident feed) but ran against the suite's shared H2 database, where the
  SSRF conformance test leaves an enabled upstream source whose failed sync
  makes `probeUpstream` report degraded — Linux and macOS surefire orders
  differ, so it failed on CI and passed locally since the status-page
  commit. The test now boots against its own empty H2 database. Its profile
  additionally neutralizes the runner-dependent probe thresholds (heap,
  pool, http-quality p95/5xx) the same way the existing memory/disk ones
  already were.
- `store-web/src/api/schema.d.ts` regenerated to match the
  `fengyu-updates/deb` contract comment change that landed without a regen.
- The frontend job gets a `setup-java` (temurin 21) step: its "Monitor jar
  embeds its SPA" step shells out to `./mvnw`, and the runner's default JDK
  predates Java 21 ("release version 21 not supported"). The step came in
  with the monitor feature and had never run on main before.
- The images job now `needs: [backend, frontend]` — release images are never
  published from a commit whose tests are red.

### Production deployment readiness

- Reverse-proxy adaptation: both apps now run
  `server.forward-headers-strategy: native`, so behind the WAF/reverse proxy
  (SafeLine terminates TLS) logs, metrics and redirects see the real client
  IP. Tomcat only honors `X-Forwarded-*` from trusted internal proxies
  (spoofed chains are ignored), and the desktop-session rate limiter switched
  from hand-parsing `X-Forwarded-For` (forgeable: any caller could prepend a
  fake entry and dodge the limit) to `getRemoteAddr()`.
- The standalone monitor ships as a production image (`Dockerfile.monitor`:
  multi-stage SPA+jar build, non-root, healthcheck, volume for its H2 mirror)
  and joins the compose `app` profile. Its anonymous API is intentional
  (ADR-011) — it is published through the reverse proxy / WAF, whose CC
  protection is its traffic defense; both images now pass
  `docker build --check` (the OCI labels sat before the first FROM, which is
  invalid and would have failed the first real image build).
- Compose hardening: the three `STORE_*_SECRET` values are mandatory at parse
  time (`.env.example` documents them), the store runs the `prod` Spring
  profile against the stack's PostgreSQL, MinIO is pinned to the final
  official image (upstream stopped publishing), every service gets resource
  ceilings and rotated json-file logs, and the minio-init bucket bootstrap now
  inherits the credentials MinIO actually booted with instead of hardcoded
  dev ones. The prod profile no longer pins the H2 dialect, which previously
  made `prod` + PostgreSQL unbootable.
- Key hygiene: freshly generated key material (JWT RSA private key, platform
  Ed25519 signing key, remote-DB AES key) is written owner-only via atomic
  temp-and-swap; the "KMS in production" javadoc/README claims that described
  an unimplemented path now describe the file-based reality and the rotation
  procedure.
- `scripts/backup-stack.sh` snapshots PostgreSQL, the store-blobs bucket and
  the key directory with retention; DEPLOYMENT.md documents the full
  production topology (SafeLine site settings incl. the 1 GiB body limit,
  forwarded-header trust, backups, restore, upgrades). CI builds and publishes
  both images to GHCR on every push to `main`.
- `scripts/deploy.sh` turns first deployment on a fresh Linux host into one
  command: Docker Engine + compose install (Aliyun docker-ce repo, with a
  `get.docker.com --mirror Aliyun` fallback), apt source mirror rewrite
  (backed up first), `registry-mirrors` merged into `/etc/docker/daemon.json`,
  `.env` generated with rolled secrets, then build/start with a health wait —
  idempotent, so re-runs keep the existing `.env` and mirror config.

### Overflow & occlusion pass

- Primary navigation: overflow is now legible. Gradient fades mark the clipped
  edges whenever the labels overflow (English locale, narrow viewports), and
  the active link is scrolled into view on route changes — previously the nav
  could stay parked wherever an earlier focus scroll left it, clipping the
  first item to a meaningless "over…" with no visible scrollbar.
- The browse sort dropdown no longer repeats the "Sort by:" prefix on every
  option row; the trigger keeps the summary and the list shows plain labels
  (`SelectMenu` gains an optional `triggerLabel`).

### Real-environment UI walkthrough fixes

- Publisher center: parse `infinia://type/namespace/slug` coordinates correctly
  (the `://` separator leaves an empty first path segment, which both
  `selectListing` and `createRelease` destructured off by one). Selecting a
  listing now resolves its UUID, so the release history and draft-resume
  wizard appear, and creating a release hits the right listing instead of a
  404 that died silently; API failures now surface as the page's status
  message with localized problem text.
- Account popover: the header bar's `text-white` leaked into the white light-
  mode panel, rendering the display name plus the user-center/library items
  invisible; the panel now sets its own text color (dark mode unchanged).
- Primary navigation: on narrow viewports the flex row collapsed the nav to
  zero width (no way to reach Discover/Browse on a phone). It now wraps onto
  its own scrollable row under the brand, and its scrollbar strip stays hidden
  while the labels overflow (English locale at desktop widths).
- Session: the access-token sessionStorage bridge is no longer dev-only, so a
  full page reload (F5, shared link) keeps the user signed in in production
  builds instead of silently logging out.
- Sign-in UX: the header sign-in button carries a `redirect` so login returns
  to the page you came from, and the listing detail's "sign in to write a
  review" hint is now that link.
- Discover hero: the animated listing/download counters render through the
  locale number formatter (thousands separators), matching every other number
  in the store; `NumberTicker` accepts an optional `format` prop.
- Status page (monitor-web): persisted incident titles are English-only in the
  database, so the zh timeline showed mixed languages; titles are now rebuilt
  from the component key + impact through the locale catalogs, falling back to
  the stored title for unknown components.
- Demo seed: the zh localization of seeded demo listings no longer renders a
  doubled "。。" when the English summary ends with a period.

### RC2 readiness fixes

- Fix `publish-app-release.sh` creating a draft before resolving its listing ID;
  cover first-time listing creation and rc2 artifact upload against a real HTTP server.
- Serve ARM64 Debian metadata at `latest-linux-arm64.yml`; restrict each CPU feed
  to lite packages so JRE/UOS or another architecture cannot be selected.
- Remove the publishing script's link to the reserved (501) update endpoint;
  document rc2 host ranges and Base64 X.509 DER trust-key provisioning.


### Distribution integrity (audit wave 2)

- Upstream aggregation now materializes every imported payload at sync time:
  the skill/MCP package is fetched, security-scanned, compatibility-packed and
  stored as a regular content-addressed blob, then platform-signed by the
  review approval like any publisher upload. Download tickets therefore carry
  a real sha256/size/signature — the FengYu client refuses digest-less
  tickets. Downloads serve the stored, immutable blob; upstream drift is
  handled at the next sync (changed metadata publishes a new version) instead
  of failing individual downloads with 409. Legacy pass-through rows are
  converted by the next sync, and requesting a download ticket for one
  upgrades it on demand (fetch → scan → store → sign); entries whose digest is
  genuinely unknown omit the integrity fields rather than faking a digest.
- The FengYu skill catalog (`/api/v1/compat/fengyu/skills-catalog`) mirrors
  the host's `SkillCatalogEntry` integrity contract: entries expose `sha256`
  (mandatory for host-side install), plus the platform `signature`/`keyId` the
  host verifies under its default `fengyu.store.require-signature=true`.
- Ticketed blob downloads carry `Content-Length` (local `Files.size`, S3
  `HEAD`), and completed artifact downloads increment the listing's download
  counter, which previously had no callers.

### Desktop update channel & git export (audit wave 2)

- The Debian desktop client can now update entirely from a store deployment:
  `GET /fengyu-updates/deb/latest-linux.yml` serves an electron-updater
  generic-feed document (`version`, `files[]` with `url`/`sha512`/`size`,
  `releaseDate`, `path`) for the newest fully rolled-out stable APP release
  shipping a `…-linux-<arch>.deb` installer, and the deb artifacts are served
  from the same directory. `sha512` is the Base64 of the SHA-512 over the
  stored blob (cached per immutable blob key) — never a fabricated value — and
  asset naming follows electron-builder's `Infinia-<version>-linux-<arch>.deb`.
- The CLAUDE marketplace export supports remote deployments: the exported
  bare repositories are served read-only over git smart HTTP at `/git/**`
  (JGit `GitServlet`, upload-pack only — push is refused at both the servlet
  and the security chain), and the new `store.export.git-public-base` property
  makes marketplace entries carry http(s) clone URLs instead of `file://`
  (unset keeps the historical `file://` behavior).
- `GET /api/v1/updates/app` is now RESERVED and deliberately returns 501: no
  shipped client ever consumed its JSON shape (the deb updater reads the
  generic yml feed, the Windows portable updater the GitHub-releases mirror),
  and the previously claimed field-compatibility with the host `UpdateInfo`
  model never held. The dead feed plumbing and the unused
  `store.app-minimum-supported-version` knob were removed.

### Hardening (audit wave 2)

- The upstream SSRF guard now pins DNS: hosts are resolved exactly once, every
  resolved address is range-checked, and plain-HTTP fetches connect to the
  validated address with the original authority pinned in the Host header —
  closing the validate-then-connect rebinding window (HTTPS keeps the
  hostname connection, where TLS endpoint verification already binds it).
- Legacy upstream pass-through downloads share one discovery round per source
  for a short window instead of re-fetching the whole upstream catalog per
  download ticket, and a failure between payload preparation and response
  streaming no longer leaks the request's temp workspace.
- Ecosystem export artifact selection is deterministic (UNIVERSAL PACKAGE
  first, stable filename order otherwise) and degrades to skipping the
  listing instead of falling back to an arbitrary `artifacts.get(0)` row.
- Bad `type`/`sort` catalog query parameters now return an actionable 400
  problem detail listing the accepted values instead of a raw enum error, and
  the artifact-id wire form is derived through a single helper shared by DTOs,
  tickets and artifactId lookups.

### Scan pipeline resilience & production hardening

- Scanning can no longer wedge or trample concurrent review decisions. A
  `ScanWatchdog` re-enqueues releases stuck in `SCANNING` for more than 10 minutes
  (worker crash before its fail-closed cleanup, a swallowed executor task, or a
  restart mid-scan); the pipeline stays idempotent so an already-moved release is
  skipped. Scan outcomes now persist through `ScanOutcomeStore` in their own
  transaction that re-reads the release row right before writing — a reviewer
  decision that landed while the scan ran is detected and respected — and the
  release table carries an optimistic-lock `row_version` (Flyway V11) so a stale
  full-row save can never flip a REJECT back to IN_REVIEW.
- Production-like deployments fail fast instead of running on weak defaults:
  `ProductionHardeningCheck` refuses to start outside the local/dev/test profiles
  while the dev-only ticket/rollout/CLI-client secrets are unchanged, and the
  `prod` profile's embedded-H2 fallback requires an explicit
  `STORE_ALLOW_EMBEDDED_H2=true` — otherwise the startup aborts before the web
  server binds, pointing at PostgreSQL.
- OAuth client-credentials issuance no longer mints `PUBLISHER`+`REVIEWER` tokens
  when the seeded CI service account is absent — it refuses with an actionable
  message instead of granting unattributable powers. A read-only
  `GET /git/**` permit rule is in place for the planned anonymous git
  smart-HTTP export endpoints (writes stay authenticated).
- Upstream items persist the adapter a sync actually resolved (`adapter_type`,
  Flyway V12): the download path no longer re-probes the source document and
  disagrees with the sync-time decision on AUTO sources, which used to leave
  MCP-registry entries un-downloadable; `UpstreamSyncService` slims down
  accordingly. The dependency solver handles the added cases, the monitor status
  view's hover tooltips are reworked, and the local blob store's temp handling
  aligns with the review fixes.

### Local database location

- The embedded-H2 database moved out of `~/.infinia-store`: development runs (`local`/`dev`
  profiles) now store it in a git-ignored temp folder under the project root
  (`<root>/tmp/database/`, resolved by walking up from the working directory to the repo
  markers, so IDEA runs from the project root and Maven runs from the module dir land on the
  same files), and a new `prod` profile stores it in the `database/` folder of the program's
  running directory for single-jar deployments (Docker keeps PostgreSQL). `store.data-dir` /
  `STORE_DATA_DIR` overrides the location in every mode. On the first development boot the
  old `~/.infinia-store/storedb` files are moved to the new location automatically — skipped
  while H2 holds its lock or the target already holds a database.
- Development runs anchor blob storage, signing keys and git exports under the same
  `<root>/tmp/` folder (operator-set `store.blob-dir`/`store.key-dir`/`store.export-dir`
  still win), so nothing store-generated is written to the user home any more. Production
  blob/key locations keep their home-anchored defaults; `~/.infinia-store` can be deleted
  after moving `blobs/` and `keys/` into the project `tmp/` by hand.

### Full-repo review fixes + production container image

- Reliability: outbox events that failed once were never retried — the relay selected
  `PENDING` rows only while failures were marked `FAILED`, silently dropping every
  webhook after its first transient error. `findPending` now includes backoff-elapsed
  `FAILED` rows and exhausted events move to a terminal `DEAD` status. Uploads no
  longer stream up to 1 GiB inside a database transaction (`completeUpload` stores the
  blob first, then claims the session atomically — concurrent replays of one presigned
  URL can no longer attach an artifact twice), and listing download/favorite counters
  are atomic SQL updates instead of read-modify-write.
- Security & correctness: `GET /publisher/releases/{id}` now enforces owner-or-admin
  (it previously leaked other publishers' drafts and scan findings); review decisions
  reject unattributable (null-reviewer) callers instead of skipping the self-review
  guard; the remote-database JDBC guard also blocks class-instantiating PostgreSQL URL
  parameters (`socketFactory`, `sslfactory`, …); `SourceFetchGuard` rejects IPv6
  unique-local (fc00::/7) addresses and `RepoFetcher.fetch` validates every URL at the
  single choke point, closing a latent marketplace-URL SSRF path. The SPA keeps its
  access token in memory in production builds (sessionStorage persistence is now
  dev-only) and clears one-shot PKCE material after login.
- Scanner hardening: an MCP template with a remote transport and no `urlTemplate` no
  longer NPEs (which wedged releases in `SCANNING` forever — the scan pipeline now
  auto-rejects on any crash instead of wedging); SafeZip's zip-bomb ratio check
  actually compares uncompressed vs compressed size, duplicate entry names are
  rejected, and the in-memory tar.gz extractor validates sizes before allocation and
  budgets every entry. MCP shell-composition rules are one shared predicate for
  `commandTemplate` and `stdioDeployment`.
- Housekeeping: rejected/oversized local uploads no longer leak `.part` temp files
  (client-triggerable disk fill); `store.blob-dir`/`key-dir` default to
  `~/.infinia-store/…` so the default profile boots without explicit config; S3
  promote failures delete the completed staging object; partial S3 credentials fail
  at boot; the status-page blob probe runs off the request thread with hard timeouts;
  upstream download streams are opened lazily inside the response body;
  `publish-app-release.sh` checks the submit HTTP status, URL-encodes the client
  secret, jq-quotes the version and warns about drafts left behind on failure;
  `build-jar.sh`'s "no jar produced" guard is actually reachable; compose dev-stack
  ports bind to loopback; a corrupt 44-byte `compat-portable.zip` test artifact was
  removed from the repo; monitor incidents sort by parsed instants; the OpenAPI
  contract documents `POST /admin/databases/deactivate`.
- New `Dockerfile` (Node → SPA, Maven → jar, non-root JRE runtime with healthcheck)
  plus `.dockerignore`; `docker compose --profile app up` runs the full store against
  the stack's PostgreSQL/Redis/MinIO with S3 artifact storage wired in. Nine new
  regression tests pin the outbox retry ladder, local temp-file cleanup, S3
  promote-failure cleanup and the MCP template null path.

### Configurable external artifact storage (ADR-012)

- Uploaded artifacts no longer require host disk: `store.storage.type=s3` points the
  artifact plane at one S3-compatible bucket (MinIO, AWS S3, any SigV4 endpoint) behind
  the unchanged `BlobStorage` port; `local` stays the default. Settings live under
  `store.storage.s3.*` with `STORE_STORAGE_*` env fallbacks — blank credentials defer
  to the SDK's default provider chain, `path-style-access` auto-selects (path-style for
  custom endpoints, virtual-hosted for AWS), and `key-prefix` lets deployments share a
  bucket. Blob keys remain `sha256/<2>/<62>` content addresses in both backends, so the
  database stays valid across a switch.
- `S3BlobStorage` streams uploads the way the local backend does: size-capped,
  SHA-256-computed in flight. Since a content-addressed key is only known after the
  last byte, multi-part uploads land on a `staging/<uuid>` object and are promoted by
  server-side copy (part-copy above the 5 GiB `CopyObject` ceiling); hash mismatch or
  cap violation aborts the multipart upload and leaves nothing behind, and single-part
  blobs go straight to their final key. Existing content short-circuits the copy.
- The `BlobStorage` port gained `checkWritable()`: the status page's artifact-storage
  probe now exercises the real backend (a put+delete probe object on S3) instead of
  assuming a local directory, and the `host-load` disk probe anchors on the key
  directory when artifacts live remotely. Half-configured S3 deployments (missing
  bucket/endpoint) fail at boot with a clear message.
- The compose stack's MinIO is now actually used: a one-shot `minio-init` service
  creates the `store-blobs` bucket. Also fixed a latent bug ported from the local
  backend — the optional `expectedSha256` check compared the expected hash with
  itself (no caller passed one, so nothing could regress).
- Covered by 26 new backend tests (22 in the default suite): mocked-S3 unit tests for
  every put path (single, multipart, dedupe, mismatch, cap, abort/cleanup),
  `ApplicationContextRunner` bean selection and boot-failure cases, a full
  `@SpringBootTest` context against S3 config (unreachable bucket degrades the `blob`
  component without taking the page down), and an opt-in wire-level MinIO smoke suite
  (`TEST_S3_ENDPOINT`, exercised end-to-end against a live MinIO: real publish-script
  upload → content-addressed object keys → empty staging).

### Standalone status monitor (ADR-011: the status page survives the store)

- New `store-monitor` module: a second Spring Boot deployable for the monitoring host. It
  polls the store's public status API (`monitor.target-base-url`, one root config — every
  probe target derives from it), mirrors the last snapshot in a local H2 file store, keeps
  its own external-reachability day buckets and incidents, and serves the merged page at
  `GET /api/v1/status` (+ `mirroredAt`/`stale` mirror metadata) and `GET /api/v1/status/incidents`.
  When the store is unreachable the frozen snapshot keeps rendering: internals hold their
  last-known indicators, the external component goes red from blackbox probes, an incident
  opens automatically, and past the stale window the page shows a "store unreachable —
  data as of …" banner. Indicator transitions alert through an optional webhook
  (`monitor.alert-webhook`, per-component throttle). Covered by 13 tests: probe ladder,
  mirror freeze/restore across restart, cold-start honesty, incident lifecycle, alert
  throttle, and a full healthy → outage → recovery integration sequence.
- New `monitor-web` workspace: the hive status page migrated 1:1 from the store SPA and
  generalized to a 19-slot honeycomb (center overall + two rings), now rendering 14
  components including External reachability, with the frozen-view banner in en/zh-CN.
  The complete hive is always on screen — it scales proportionally to fit both the
  width and the remaining height of the viewport, with no internal scroll containers
  (verified cell-by-cell at 1280×900 and 375×812). Served embedded from the monitor jar
  (`build-monitor-jar.sh`), same single-origin pattern as the store.
- The store's own status page grew comprehensive in-process probes — host storage
  capacity, host memory (Linux reads /proc/meminfo `MemAvailable`; the JDK's MemFree
  counter is near-zero on any healthy Linux box), JVM heap, Hikari pool saturation, and
  HTTP quality (5xx ratio + count-weighted p95 from the published percentile) — taking
  `GET /api/v1/status` from 8 to 11 components. The three host-level probes report as one
  merged `host-load` cell (worst-of storage/memory/heap): operators act on "the host is
  loaded", not on three separately blinking cells. Thresholds live under
  `store.monitoring.*` (`STORE_MONITOR_*` env), each defaulting sanely and overridable
  per deployment.
- The store SPA's `/status` route now redirects to the standalone monitor
  (`VITE_MONITOR_BASE_URL` at build time); the in-SPA StatusView and its locale slice were
  removed in favor of the monitor's page. The store's status API itself is unchanged and
  remains the monitor's data source.

### Public service-status page (需求：store 服务监控页, modeled on the npm status page)

- New anonymous status page at `/status` (footer link added) backed by two public API endpoints:
  `GET /api/v1/status` returns the overall indicator, the eight store components (Store API,
  Store Web, Sign-in & OAuth, Update feed & downloads, Database, Artifact storage, Security
  scanning, Upstream sync) and each component's 90-day daily history with uptime percentages;
  `GET /api/v1/status/incidents` returns the incident feed, newest first. Both are anonymous on
  purpose — a status page that needs a login is useless during an outage.
- Live probes, not vanity greens: the database gets a real `SELECT 1` round-trip (latency above
  1.5s reports degraded), artifact storage verifies the blob directory is writable, upstream
  sync rides the sync ledger (an enabled source whose last sync failed degrades the component),
  delivery/auth derive from their hard dependencies, and the in-process components report the
  strongest signal available: the request you are holding was served. A background sampler
  (`store.status.sample-interval-ms`, default 60s) records per-UTC-day buckets even when nobody
  is watching, and days without samples render as honest "no data" instead of fake 100% green.
- Self-managing incidents: a failing probe opens one incident per component automatically
  ("Database is unavailable", impact outage/degraded), recovery resolves it with the measured
  duration — no manual incident tooling. The UI mirrors the statuspage layout: overall banner,
  per-component 90-day bar strips with hover tooltips and uptime percentages, and the
  date-grouped past-incidents feed; en/zh-CN copy included. Flyway V10 adds the
  `service_uptime_day` buckets (pruned to the observation window) and the `service_incident`
  table; the contract gains the `Status` tag with `StatusPage`/`Incident` schemas.
- Covered end-to-end by `ServiceStatusTest` (anonymous access, 90-day history shape, honest
  no_data days, sample aggregation, public incident feed) and `status.spec.ts` on the frontend
  (banner/components/incidents rendering, error recovery); the degraded → resolved lifecycle
  was verified live against a real upstream sync failure and recovery.

### OAuth desktop sign-in stays on the request origin (intranet self-hosted fix)

- The authorization server's sign-in entry point redirected the browser to an absolute URL
  derived from `store.base-url` (`webSignInUri()`). When the host the FengYu desktop talks to
  differs from the configured `store.base-url` host (e.g. the channel is `localhost:8080`
  while base-url carries the LAN IP), the saved authorization request lives in one host's
  session cookie while the sign-in form posts to the other host — login succeeds, there is no
  saved request to resume, and the user simply lands in the store's own web UI. The desktop
  app's loopback callback never fires and its sign-in attempt spins PENDING until timeout.
  The entry point (and the session-login failure handler) now redirect to the **request's own
  origin** (`<origin>/signin?oauth=1`), so the whole browser leg — authorize, sign-in,
  session-login, resume — shares one host-scoped cookie jar regardless of how base-url is
  pinned. `store.base-url` keeps its role for the issuer and other absolute links. Verified
  live with a deliberately mismatched base-url: authorize → login → resume → loopback
  callback code → token exchange all pass; pinned by
  `authorizeRedirectsToASameOriginSignIn`.

### Rotating per-install refresh credentials for the FengYu desktop client

- Long-lived desktop sessions without a shipped secret and without touching the OAuth client
  registration: the public `fengyu-desktop` client (PKCE-only, RFC 8252 §8.5) still gets no
  refresh token from the authorization server — SAS hard-gates them away from public clients
  and flipping the registration to confidential breaks every deployed client's sign-in in
  either direction. Instead the store now mints its own rotating credential:
  - `POST /api/v1/auth/desktop-session` (bearer) binds one opaque 256-bit credential to the
    session ledger row right after the code exchange; re-issuing on a session kills the
    previous credential. Only the SHA-256 hash is persisted (`refresh_token` table, Flyway
    V9), so a database leak leaks no live bearer credentials.
  - `POST /api/v1/auth/refresh {refreshToken}` is the credential-only refresh (no client
    authentication — no cross-deployment pairing to drift): single-use with atomic consume,
    rotation on every refresh, 30-day sliding / 90-day absolute TTL, and the new access
    token keeps the session's `sid`, so ledger revocation applies immediately.
  - Reuse detection: presenting an already-consumed credential revokes the whole family AND
    the session — token theft ends in detection within one refresh cycle, not silent
    sharing. Revoking a session from the security page cascades to its credential family.
  - `POST /api/v1/auth/revoke {refreshToken}` is the uniform sign-out (always 204, never
    confirms existence); all failures are an indistinguishable 401 `invalid_credentials`,
    responses carry `Cache-Control: no-store`, and the unauthenticated endpoints are
    rate-limited per client address (`store.refresh.rate-limit-per-minute`, default 30).
    TTLs are configurable via `store.refresh.sliding-ttl-days` / `store.refresh.absolute-ttl-days`.
- Audit trail: `auth.desktop_session`, `auth.refresh` (rotated), `auth.refresh_replay`
  (family revoked, with the detection cause), `auth.refresh_revoked`.
- Covered end-to-end by `DesktopSessionFlowTest` (issue → rotate → the rotated token works on
  /me, replay revokes family + session, session-revocation cascade, expiry, uniform
  rejection, sign-out) and `DesktopSessionRateLimitTest`. Verified live against the FengYu
  host: restart-without-relogin, replay-triggered self-heal back to the local account, and
  the host-side policy that keeps the credential memory-only over plain-HTTP channels.

### SKILLHUB_REGISTRY upstream adapter — WorkBuddy open skills via the SkillHub Open API

- New upstream adapter type `SKILLHUB_REGISTRY` aggregates Tencent's open skill platform behind
  WorkBuddy (`https://api.skillhub.cn`, ~136k skills). Discovery pages the `/api/skills`
  catalog envelope — metadata-only as before, default window `pages=3` × `pageSize=100` with
  `source` / `category` / `keyword` filters and the `pages` / `pageSize` knobs riding in the
  registered URL's query string; downloads pin the synced version through
  `/api/v1/download`, whose 302 to a signed Tencent COS address is followed manually so every
  redirect hop re-passes the SSRF guard. Register with
  `POST /api/v1/admin/upstreams {"marketplaceUrl":"https://api.skillhub.cn","adapterType":"SKILLHUB_REGISTRY",...}`;
  AUTO detection also recognizes SkillHub URLs, and catalog drift (e.g. an upstream version
  bump) keeps failing downloads with 409 `upstream_drifted` until a re-sync.
- Verified by `skillhubRegistryAggregatesWorkBuddySkillsWithRedirectDownloadAndDriftGuard`
  (stub registry with the 302 download hop) and a live smoke check against the real
  `api.skillhub.cn` list/download endpoints and a payload zip (root `SKILL.md`, as the
  adapter's shallowest-root location expects).
- The upstream is now **seeded by default**: `UpstreamCatalogBootstrap` idempotently registers
  `SkillHub (WorkBuddy)` (namespace `skillhub`, default window
  `store.upstream.defaults.skillhub-url` = `https://api.skillhub.cn/api/skills?pages=1`, the
  top 100 by downloads) on first boot and indexes it, so deployments aggregate WorkBuddy's
  open skills without a manual registration. `store.upstream.defaults.enabled=false` opts out;
  seeding runs after account seeding (`SeedData` now has an explicit listener order) and the
  existing never-successfully-synced retry rule makes later boots re-index until it succeeds.
  Covered by `UpstreamDefaultsBootstrapTest` (isolated H2 + local SkillHub stub).

### fengyu-desktop is now a public OAuth client (PKCE only)

- The desktop host client registration drops its client secret
  (`STORE_DESKTOP_CLIENT_SECRET` is gone from `store.*` properties): a secret baked into the
  distributed FengYu build is public knowledge, not a credential (RFC 8252 §8.5). Sign-in is
  the standard authorization-code + PKCE loopback flow with no shared secret; FengYu
  deployments that still pair with a confidential registration keep working via
  `FENGYU_STORE_CLIENT_SECRET` on the host side.
- Consequences of the SAS 7 public-client gates (verified by `AuthAndAccountFlowTest` and a
  live two-process run): the refresh-token grant is never issued
  (`OAuth2RefreshTokenGenerator` hard-gates public clients), so the 30-minute access token
  expires into a browser re-login / anonymous degradation, and the `/oauth2/revoke`
  endpoint rejects public clients (401 — it authenticates via `code_verifier`, which a
  revocation request cannot carry). Host sign-out stays local-first: the binding and OS
  keychain entry are removed client-side, and server-side tokens expire naturally. Long-lived
  sessions remain a store-side mechanism (per-install credentials or a BFF), not a shipped
  secret.

### Admin manual upload of host-app update packages (the store replaces the FY-Proxy distribution center)

- New PLATFORM_ADMIN surface `/api/v1/admin/app-releases`: `POST` starts a manual upload
  (ensures the conventional `store.app-coordinate` listing — reserving its namespace on first
  use — drafts the release and returns the same presigned PUT URL the publisher pipeline uses),
  `DELETE /{releaseId}` hard-removes a release of any status (the app update feed and the
  FengYu compat mirror stop serving it immediately), and `GET` lists the uploads for the
  console. `POST /{releaseId}/publish` publishes instantly — the platform admin is the review
  decision, with envelope + artifact platform signing and a distinct `release.admin-publish`
  audit event.
- Version and channel are inferred from the package filename when omitted
  (`Infinia-<semver>-win32-x64-portable.zip`; a pre-release suffix names the channel, e.g.
  `-beta.1` → beta). `PublisherService.createDraftRelease`/`createUploadSession` gained a
  `platformAdmin` bypass so admins can operate the CI-owned host listing.
- Admin console gains an **Update packages** tab: visible file picker (version/channel read
  from the filename and shown as badges before upload), upload-and-publish in one click, and
  per-release delete with confirmation. zh-CN/en copy included.
- `AppReleaseFlowTest` covers the full loop: 403 for non-admins, filename inference, instant
  publish, mirror serving with mandatory sha256 digest, and deletion.

## 0.1.0 (2026-08-26)

Initial implementation of the Infinia Store Platform (design §1–§17, Phase 1–3 scope).

### Backend
- Modular monolith: `store-contract`, `store-domain`, `store-infrastructure`, `store-scanner`,
  `store-application` on Spring Boot 4.1.1 / Java 21 with an independent version line.
- Unified catalog for APP / PLUGIN / SKILL / MCP / FLOW with `infinia://` coordinates, SemVer
  ranges (npm-compatible semantics incl. prerelease gating), channels and rollout.
- Publishing pipeline: namespace ownership via organizations, draft releases, HMAC-ticketed
  uploads, async scanning, automatic rejection of malicious packages, human review with
  self-review prohibition, Ed25519 platform signing on approval, transactional outbox with
  HMAC-signed webhooks.
- Security: OAuth 2.1 authorization server (authorization code + PKCE, client credentials via
  a seeded CI account), JWT resource server with session-ledger revocation, problem+json
  errors localized in English and 简体中文, per-write audit events.
- Delivery: download tickets, content-addressed local blob store, app update feed with stable
  HMAC(installId) rollout bucketing and GitHub-compatible `UpdateInfo` fields.
- 142 tests: domain policies, scanner rules, and full-HTTP integration flows.

### Frontend
- `store-web` SPA (Vue 3.5.41, Vite 7, Pinia, vue-router, Tailwind CSS 4, vue-i18n en/zh-CN).
- Discover / Browse / Listing detail (install state machine + permission confirmation) /
  Library / Account (sessions & devices) / Publisher center / Review queue / OAuth callback.
- `@infinia/magic-ui-vue`: controlled MIT-licensed Vue port of ten Magic UI components,
  CSS-first, `prefers-reduced-motion` aware, with port notes and tests.
- API DTOs generated from the OpenAPI 3.1 contract (`openapi-typescript`); CI checks drift.
