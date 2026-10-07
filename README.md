# FengYu-WebSite

> Formerly **Infinia Store Platform** (`infinia-store-platform`) — the repository was renamed;
> old GitHub links redirect.

The cloud control plane of the [Infinia / FengYu](https://github.com/MuskStark) ecosystem: a
unified catalog, publishing pipeline, review workflow, signed delivery and account system for
**five artifact classes — APP, PLUGIN, SKILL, MCP, FLOW** — built on the local-first
principles of the FengYu host. The deployable service is **InfiniaWebService** — one origin
serving the store SPA at `/store`, the official website at `/`, the REST API and the OAuth
authorization server.

> The store extends *distribution, identity and the trust chain*. It never turns the local
> runtime into a cloud-dependent SaaS client: the host keeps running everything already
> installed when the store is offline (design §1).

- **Backend:** Java 21 · Spring Boot 4.1.x (modular monolith) · PostgreSQL · Flyway · OAuth 2.1
  authorization server · Ed25519 release signing
- **Frontend:** Vue 3.5 (English-first UI with 简体中文 switch) · Vite 7 · Pinia · vue-i18n ·
  Tailwind CSS 4 · a controlled, MIT-attributed Vue port of Magic UI
- **Tests:** 303 backend tests (unit + full HTTP integration) and 39 frontend tests

## Architecture

```text
store-platform/
├── store-contract/         # Dependency-free contract: coordinates, SemVer, DTOs, OpenAPI 3.1
├── store-domain/           # Pure domain model + policies (state machine, dependency solver,
│                           #   permission diff, rollout bucketing, UUIDv7)
├── store-infrastructure/   # JPA persistence, Flyway, content-addressed blob store
│                           #   (local FS or any S3-compatible bucket), outbox relay, cache
├── store-scanner/          # Safe unpacking, manifest validation for all 5 classes,
│                           #   secret/malicious-content scanning, SBOM, Ed25519
├── store-application/      # InfiniaWebService: the Spring Boot app (API + auth server +
│                           #   embedded store SPA at /store and official website at /)
├── store-monitor/          # Standalone status monitor (ADR-011): probes + mirrors the
│                           #   store, serves the status page when the store is down
├── store-web/              # React + Vite frontend: store / publisher / review + project introduction
├── monitor-web/            # React status-page SPA (embedded in the monitor jar)
├── OfficialPlugins/        # FengYu official plugins (migrated from the main FengYu repo;
│                           #   FengYu toolchain line, NOT part of the store reactor —
│                           #   see OfficialPlugins/README.md)
└── store-web/src/components/magicui/  # Magic UI original components (MIT, verbatim from the registry)
```

Key decisions are frozen in [docs/adr](docs/adr/ADR-001-modular-monolith.md); the full design
lives in [docs/design/STORE_PLATFORM_DESIGN.md](docs/design/STORE_PLATFORM_DESIGN.md).

## Quickstart (single jar)

Build the unified frontend once, then package it with the backend into one executable
Boot jar. The Vite output under `classpath:/static` serves both the store and
project introduction through one router; API and OAuth share the same origin:

```bash
yarn install
./build-jar.sh    # builds the unified frontend, embeds it, runs tests, verifies the jar
# faster iteration: ./build-jar.sh --skip-tests, or --skip-web to reuse dist/ and out/

java -jar store-application/target/InfiniaWebService-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=local
```

Open http://localhost:8080/store — the store SPA; the official website lives at
http://localhost:8080/. The `local` profile runs on embedded H2 stored in a
temporary folder under the project root (`tmp/database/`, git-ignored) — no Docker
needed. Blobs, signing keys and git exports live under the same `tmp/` folder, so
nothing store-generated lands in your home directory. Seeded demo accounts
(password `Password123!`):

| Account | Roles |
|---|---|
| `admin@infinia.local` | PLATFORM_ADMIN |
| `reviewer@infinia.local` | REVIEWER |
| `publisher@infinia.local` | PUBLISHER |
| `user@infinia.local` | USER |

The local profile seeds accounts only; its catalog starts empty. Integration tests explicitly
enable their own demo fixtures.

For a production run without Docker, use the `prod` profile — the database then lives in
the `database/` folder of the program's running directory (`STORE_DATA_DIR` overrides the
location in every mode). Point the platform at its public address so OAuth redirects and
issued tokens match it (`store.base-url=https://store.example.com`) and provide the
secrets listed under [Production-like stack](#production-like-stack-docker).

### Split frontend development

To work on the SPA with Vite hot reload, run the backend with the `dev` profile
(keeps the OAuth redirect on the Vite origin) next to the dev server:

```bash
./mvnw spring-boot:run -pl store-application -Dspring-boot.run.profiles=dev
yarn web    # :8089, proxies /api and /oauth2 to :8080
```

### FengYu host sources

Register native `.fyp` listings as a `FENGYU` source using
`http://localhost:8080/api/v1/compat/fengyu/catalog`. FengYu's direct Skill catalog is
`http://localhost:8080/api/v1/compat/fengyu/skills-catalog`; MCP entries are available at
`http://localhost:8080/api/v1/compat/fengyu/mcp-catalog` and through the Native install API.

Publisher-owned Skill/MCP blobs may also be exposed at
`http://localhost:8080/api/v1/compat/fengyu/claude-marketplace.json`. Aggregated upstream
entries are intentionally excluded from that disk-backed Git export: their payloads ship
through the store's signed blob delivery instead. Marketplace entries default to
`file://` clone URLs (host on the same machine); set `store.export.git-public-base`
(for example `https://store.example.com/git`) to serve the exported repositories to
remote hosts through the read-only smart-HTTP mount at `/git/**` — clone/fetch only,
push is refused. Synchronization materializes every
imported upstream payload — fetch, security scan, compatible package build — into the
content-addressed blob store, so tickets and catalogs carry a real, platform-signed
digest and downloads serve the stored blob without re-touching the upstream.

For rc2 clients, declare a compatible release range such as
`requiresHost: ">=4.0.0-rc.1 <5.0.0"`; `>=4.0.0` intentionally excludes rc2.
The native FengYu store client requires a trusted platform Ed25519 key. Provision
`trusted-store-keys.json` in the host runtime root with
`{"keys":[{"id":"<platform key ID>","publicKey":"<Base64 X.509 DER public key>"}],"revokedKeys":[]}`.
Obtain the public key from the deployment operator through a trusted channel;
never distribute the store's private `.b64` signing-key file. For a loopback/LAN
store, also enable the host's private-network setting and configure its store API
base. Production should use HTTPS and retain signature verification.

### Main-application (host) updates

The store also distributes the FengYu host itself. APP listings carry the full release
matrix — installed (`INSTALLER`: NSIS exe, dmg, deb) and portable (`PORTABLE`: zip,
AppImage, portable web archive, fat JAR) distributions per platform/arch, plus build
variants (`lite`, `jre`, `uos`, `web`, `jar`). Kind, platform, arch and variant are
inferred from the release filename at upload time (see `PublisherService`).

Publish a host release from its GitHub release assets:

```bash
STORE_BASE=https://store.example.com \
STORE_CLI_CLIENT_SECRET=<secret> \
  scripts/publish-app-release.sh 4.0.0 ./release-assets stable
```

The script authenticates with the store CLI client (CI service account), creates the
`official/fengyu-host` APP listing on first use, uploads every asset through the presigned
pipeline and submits for review. Desktop hosts update through two anonymous surfaces:

- The Debian client (electron-updater generic provider, channel `latest`) fetches
  `GET /fengyu-updates/deb/latest-linux.yml` (x64) or
  `GET /fengyu-updates/deb/latest-linux-arm64.yml` (ARM64) — an electron-builder-format document
  (`version`, `files[]` with `url`/`sha512`/`size`, `releaseDate`, `path`) announcing the
  newest fully rolled-out stable release that ships a `…-linux-<arch>.deb` installer, with
  the deb artifacts served from the same directory and digests derived from the stored
  blobs. Each feed includes only its CPU architecture and the `lite` variant;
  JRE and UOS packages are excluded. RC releases are downloadable from the catalog
  after review, but these stable-only automatic update feeds do not announce them.
- The Windows portable updater fetches the GitHub-releases-compatible mirror at
  `GET /api/v1/compat/fengyu/fengyu-releases/api/releases/latest`.

`GET /api/v1/updates/app` is RESERVED and deliberately answers `501`: no shipped client
consumed its historic JSON shape, so an accidental integration fails loudly instead of
relying on an unmaintained contract. Every published release also serves a
sha256sum-compatible manifest at `GET /api/v1/releases/{releaseId}/checksums.txt`
(design §8.3).

### Production-like stack (Docker)

```bash
cp .env.example .env             # fill in the three STORE_*_SECRET values — compose enforces them
docker compose up -d             # PostgreSQL 17, Redis 7, MinIO (+ store-blobs bucket)
./build-jar.sh
java -jar store-application/target/InfiniaWebService-0.1.0-SNAPSHOT.jar
```

Secrets come from the environment (`STORE_TICKET_SECRET`, `STORE_ROLLOUT_SECRET`,
`STORE_CLI_CLIENT_SECRET`); JWT key material is generated on first boot and
persisted as PEM files under `store.key-dir` — back them up and rotate by
swapping the files (see DEPLOYMENT.md).

### External artifact storage (S3 / MinIO, ADR-012)

Uploaded artifacts live in content-addressed storage behind the `BlobStorage`
port. The default is the local filesystem (`store.blob-dir`); production can
point the store at one S3-compatible bucket instead — same blob keys either
way, so the database stays portable across the switch:

```bash
STORE_STORAGE_TYPE=s3 \
STORE_STORAGE_S3_ENDPOINT=http://localhost:9000 \   # MinIO; omit for AWS S3
STORE_STORAGE_S3_BUCKET=store-blobs \
STORE_STORAGE_S3_ACCESS_KEY=store \
STORE_STORAGE_S3_SECRET_KEY=store-secret \
java -jar store-application/target/InfiniaWebService-0.1.0-SNAPSHOT.jar
```

All knobs live under `store.storage.s3.*` (`region`, `path-style-access`,
`key-prefix` for sharing a bucket). Blank credentials fall back to the SDK's
default provider chain (env vars, profile, instance role), and the compose
stack's `minio-init` one-shot creates the `store-blobs` bucket. Uploads stream
through multipart staging and are promoted by server-side copy; the status
page's artifact-storage probe writes and deletes a real probe object, so a
misconfigured bucket shows up red on `/status`.

### Production container image

The repo ships a production `Dockerfile` (multi-stage: Node → Vite SPA, Maven →
executable Boot jar, then a non-root JRE runtime with a healthcheck on
`/actuator/health`):

```bash
docker build -t infinia-webservice .
docker run -d --name store -p 8080:8080 \
  -e STORE_BASE_URL=https://store.example.com \
  -e STORE_TICKET_SECRET=… -e STORE_ROLLOUT_SECRET=… -e STORE_CLI_CLIENT_SECRET=… \
  -v store-data:/var/lib/infinia-store \
  infinia-webservice
```

Local blob/key state lives under `/var/lib/infinia-store` (mount it as a
volume, or point `STORE_STORAGE_*` at your object storage as above). The image
build skips tests — run `./mvnw verify` in CI first, matching `build-jar.sh`
usage. A matching `Dockerfile.monitor` packages the standalone status monitor
(non-root, healthcheck, volume for its H2 mirror). The compose stack can also
bring the whole application up against its
PostgreSQL/MinIO dependencies:

```bash
docker compose --profile app up -d --build   # store :8080 + monitor :8090, loopback-only
```

See DEPLOYMENT.md for the production topology behind a reverse proxy / WAF
(TLS, body-size limits, forwarded-header trust), backups and upgrades. The
`store` service is behind the opt-in `app` profile, so plain
`docker compose up -d` still starts only the dependency stack, and its ports
bind to loopback — put a TLS-terminating reverse proxy in front for real
exposure.

### Standalone status monitor (two-server deployments, ADR-011)

The public status page runs as its own application on a second host, so it stays
reachable when the store is not. The monitor polls the store's anonymous status
API and mirrors the last snapshot; during a store outage it renders the frozen
internals plus a live red `external` component, auto-opens the outage incident
and (optionally) alerts a webhook.

```bash
./build-monitor-jar.sh
MONITOR_TARGET_BASE_URL=https://store.example.com \
MONITOR_ALERT_WEBHOOK=https://hooks.example/… \
java -jar store-monitor/target/store-monitor-0.1.0-SNAPSHOT.jar   # :8090
```

All settings live under `monitor.*` / `MONITOR_*`; `target-base-url` is the one
root config (re-point at a moved store and restart). Put the store behind
`store.example.com`, the monitor behind `status.example.com`, keep
`/api/v1/status` out of any CDN cache in front of the store, and give the
monitor its own TLS via nginx. The store SPA's `/status` link redirects to the
monitor via runtime config — set `STORE_MONITOR_PUBLIC_URL` (e.g.
`https://status.example.com`) on the store and restart; no image rebuild is
needed (`VITE_MONITOR_BASE_URL` at build time still works as a fallback). A
cheap third-party ping on the
monitor itself is recommended — it is the one component nothing else watches.

The page updates live: the monitor probes the store every 5 s, confirms faults
after 2 consecutive failures (the first failure shows as 确认中, not a flip),
and pushes confirmed changes to browsers over SSE
(`GET /api/v1/status/events`) — snapshot on connect, per-component events
afterwards, missed events replayed on reconnect. Reverse-proxy requirements
for the stream (no buffering, read timeout above the 15 s heartbeat) are in
DEPLOYMENT.md "Status page live stream (SSE)". Availability statistics are
interval-based (uptime over observed time, per-day coverage; outage time
counts as unavailable) — days from before the cutover keep their
sampled-statistics marks.

## The publishing pipeline

```text
create org (reserves namespace) → create listing → draft release
  → presigned upload (HMAC ticket, size-capped)
  → submit → async scan (zip-slip / zip-bomb guards, manifest validation per class,
              secret & malicious-content rules, MCP template policy, CycloneDX SBOM)
  → auto-reject on blocking findings  |  IN_REVIEW
  → reviewer decision (self-review forbidden) → APPROVE
  → platform signs the release envelope (Ed25519) → PUBLISHED
  → outbox event → webhooks (HMAC-SHA256 signed), catalog visible
```

End-to-end this flow — including malicious-package auto-rejection — is covered by
`PublishingPipelineTest`.

## API

- Contract (source for clients): [`store-contract/src/main/resources/contract/openapi.yaml`](store-contract/src/main/resources/contract/openapi.yaml)
- Base path `/api/v1`; errors are RFC 9457 `application/problem+json` with stable `code` +
  `traceId`, localized in **English and 简体中文** via `Accept-Language`
- Anonymous: catalog, listing details, resolutions, update feed, download tickets, registration
- Authenticated: library, favorites, sessions/devices, publisher, review, admin
- The SPA logs in with OAuth 2.1 Authorization Code + **PKCE**; the CLI uses client
  credentials mapped to a seeded CI service account

Regenerate frontend API types after changing the contract:

```bash
yarn workspace @infinia/store-web gen:api
```

## Security properties

- SHA-256 content addressing + Ed25519 platform signatures on every artifact; revocable keys
  with `keyId` rotation support
- MCP listings ship **reviewed templates only** — never secrets; installs disabled by default
- Sessions are ledgered in the token (`sid` claim) and revoking one invalidates the JWT at the
  resource server immediately
- Rollout bucketing uses `HMAC-SHA256(rolloutSecret, installId)` — never account, email or IP
- Scanning failures cannot be bypassed by publishers; reviewers cannot approve their own
  releases; all publisher/admin writes append audit events

## Development

```bash
./mvnw verify                        # backend: 303 tests
yarn web:test && yarn web:build      # SPA: i18n parity, client, component tests + typecheck
yarn web                            # one dev server: :8089/store store, :8089/ introduction
# yarn website / yarn website:build remain aliases of web / web:build
```

- Database changes go through Flyway only (`store-infrastructure/src/main/resources/db/migration`)
- Integration tests run on H2 in PostgreSQL compatibility mode — no Docker required; the same
  migrations execute on PostgreSQL in production
- Backend commits require English messages; UI copy is English-first with zh-CN switch and a
  test enforcing key parity

## License

GPL-3.0 (see [LICENSE](LICENSE)). `store-web/src/components/magicui/` (and the
shadcn/ui base parts in `store-web/src/components/ui/`) are the MIT-licensed
originals copied verbatim from the [Magic UI](https://magicui.design) registry
(provenance and refresh instructions: `store-web/src/components/magicui/README.md`).
