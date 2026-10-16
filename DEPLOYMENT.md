# Production Deployment

Split-host deployment of FengYu-WebSite (the store platform) behind a dedicated
reverse proxy / WAF (tested topology: [SafeLine / 雷池](https://waf.chaitin.cn/)):
the store stack runs on one server, the standalone status monitor on its own
server (ADR-011 — the status page must survive a store outage), and the WAF
publishes both. Everything ships in this repo: `docker-compose.yml` (store +
dependency planes), `docker-compose.monitor.yml` (monitor host),
`Dockerfile` (store), `Dockerfile.monitor` (monitor), `scripts/deploy.sh`
(host bootstrap — store by default, `--monitor-host` for the monitor host),
`scripts/upgrade.sh` (unattended upgrades — `--monitor` for the monitor
host), `scripts/deploy-assets.sh` (optional Cloudflare Pages offload),
`scripts/backup-stack.sh`. Single-host installs are
still supported: add `--profile monitor` to the store-host commands.

## Topology

```
Internet ──HTTPS── SafeLine WAF (TLS termination, WAF/CC protection)
                       │ http://<store-host>:8080   → InfiniaWebService (/store + / introduction)
                       │ http://<monitor-host>:8090 → monitor (public status page)

Optional: with Cloudflare in front and assets offloaded (see "Static assets
on Cloudflare Pages"), the hashed /assets/** files are served by Cloudflare
Pages and only the HTML shell + API go through the WAF to the store host.

Store host: docker compose --profile app          Monitor host: -f docker-compose.monitor.yml
   ├── postgres:17 (pgdata)                          └── monitor (monitordata: H2 mirror
   ├── minio       (miniodata, store-blobs)               + history; GHCR image,
   ├── redis:7     (reserved, not yet wired)              no build toolchain)
   └── store       (storedata: blobs fallback + JWT keys)
```

The app ports (store 8080, monitor 8090) publish on all interfaces by
default so the WAF — or LAN clients — reach them directly
(`STORE_BIND_HOST` / `MONITOR_BIND_HOST` rebind them, e.g. 127.0.0.1 for a
co-located proxy). The dependency-plane ports (PostgreSQL, MinIO, Redis)
stay loopback-bound: they carry the stack's credentials.

## First deployment

### Quick path

On a fresh Linux host with the repo cloned, `scripts/deploy.sh` automates
steps 1–2 below plus host preparation (Docker install from the Aliyun
docker-ce repo, apt source mirror rewrite, `registry-mirrors` in
`/etc/docker/daemon.json`, secret generation):

```sh
sudo scripts/deploy.sh --base-url https://store.example.com
# non-interactive / unattended:
sudo scripts/deploy.sh --yes --base-url https://store.example.com
```

It is idempotent (existing `.env` and mirror config are preserved) and prints
the remaining manual wiring (the SafeLine sites below). Steps 1–2 still apply
verbatim when you prefer to run them by hand.

1. **Environment file** (mandatory — compose refuses to run without it):

   ```sh
   cp .env.example .env
   # fill in: STORE_TICKET_SECRET / STORE_ROLLOUT_SECRET / STORE_CLI_CLIENT_SECRET
   #          (openssl rand -hex 32), POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD,
   #          STORE_BASE_URL (public https:// URL), and database/MinIO creds
   ```

   The store boots under the `prod` Spring profile; `ProductionHardeningCheck`
   aborts startup if any dev-only secret survives, and `minio-init` propagates
   your MinIO credentials into the bucket setup and the store's S3 config.

2. **Start the stack (store host)**:

   ```sh
   docker compose --profile app up -d --build
   docker compose ps          # wait for store to report healthy
   # single-host install: add --profile monitor for the co-located monitor
   ```

3. **SafeLine sites** — two sites, both with HTTP upstreams:

   | Site | Upstream | Notes |
   |---|---|---|
   | Store | `http://<store-host>:8080` | Request body limit ≥ 1073741824 (1 GiB) — matches `store.max-upload-bytes`; SafeLine's default is far lower and large artifact uploads will fail with 413 |
   | Monitor (status page) | `http://<monitor-host>:8090` | No uploads, default body limit is fine; can use `GET /actuator/health` as the upstream health-check path |

   TLS terminates at SafeLine; certificates live there.

4. **Forwarded headers** (already configured, for awareness):
   both apps run `server.forward-headers-strategy: native`, so Tomcat honors
   `X-Forwarded-*` only when the peer is an internal proxy (default
   `internal-proxies` covers loopback + all private ranges — SafeLine's hop
   qualifies). Real client IPs reach logs, metrics and the per-IP rate limiter;
   spoofed `X-Forwarded-For` from outside is ignored. If SafeLine connects from
   a non-private address, extend `server.tomcat.remoteip.internal-proxies`.

5. **Monitor host (8090)** — the standalone status monitor runs on its own
   server so the page survives a store outage. One command from the repo root
   (installs Docker where missing, generates `.env`, pulls the CI-published
   GHCR image, waits for health, and probes the store once from that host):

   ```sh
   sudo scripts/deploy.sh --monitor-host --target-url https://store.example.com
   # ghcr.io unreachable from the host? add --image-registry ghcr.m.daocloud.io
   # air-gapped? add --build to compile the image locally instead
   ```

   Manual equivalent:

   ```sh
   printf 'MONITOR_TARGET_BASE_URL=https://store.example.com\n' > .env
   docker compose -f docker-compose.monitor.yml up -d
   ```

   `MONITOR_TARGET_BASE_URL` is the store's URL **as this host reaches it** —
   prefer the public https URL through the WAF so the monitor measures true
   external reachability; the store's LAN address works for internal-only
   installs. Pin the image by digest (`MONITOR_IMAGE_TAG`) for immutability;
   `MONITOR_IMAGE_REGISTRY` swaps in a GHCR proxy for networks without direct
   ghcr.io access. The status page and its API are anonymous **by design**
   (ADR-011: a status page that needs a login is useless during an outage);
   the WAF's CC protection is its traffic defense. Upgrades on this host:
   `docker compose -f docker-compose.monitor.yml pull && docker compose -f docker-compose.monitor.yml up -d`.

## deploy.conf — shared script configuration

`deploy.sh` and `deploy-assets.sh` read optional KEY=VALUE settings from a
`deploy.conf` at the repo root (gitignored; mode 600 — the assets
questionnaire stores the Cloudflare token in it). Precedence: command-line
flags > environment variables > `deploy.conf` > built-in defaults — scripted
environments that export the variables directly are therefore unaffected.

```conf
STORE_BASE_URL=https://www.example.com          # deploy.sh store prefill
MONITOR_TARGET_BASE_URL=https://www.example.com # deploy.sh --monitor-host
MONITOR_ALERT_WEBHOOK=
MONITOR_IMAGE_REGISTRY=ghcr.m.daocloud.io       # GHCR proxy when needed
MONITOR_IMAGE_TAG=latest
APT_MIRROR=mirrors.aliyun.com
REGISTRY_MIRRORS="https://docker.m.daocloud.io https://docker.1ms.run"
ASSETS_BASE_URL=https://assets.example.com      # deploy-assets.sh
ASSETS_PAGES_PROJECT=infinia-assets
CLOUDFLARE_ACCOUNT_ID=<id>
CLOUDFLARE_API_TOKEN=<token>                    # Pages · Edit; secret!
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
NODE_IMAGE=node:22-alpine
```

Interactive: `deploy.sh` asks which host to deploy (store / 监控 answers
work too) whenever the flags don't already imply it — `--target-url` and the
other monitor-only flags select the monitor host, store flags the store, and
a box already running the standalone monitor is preselected; `upgrade.sh`
auto-detects the same way. `deploy-assets.sh` asks for missing
Cloudflare/Pages values and offers to save them to `deploy.conf` —
`scripts/deploy-assets.sh --configure` runs only that questionnaire (answers
can be piped in for pre-provisioning). Unattended contexts (scripts, `--yes`) never prompt: missing values fail
fast with the fix hints.

## First admin

Production boots with zero accounts by design — the demo credentials
(`admin@infinia.local` / `Password123!`) are public knowledge and seeding
refuses to run outside the local/dev/test profiles. Instead, the **first
account registered on an empty deployment automatically receives
PLATFORM_ADMIN**: open the site right after first boot, register your own
address, and you own the instance. Every later registration gets the plain
USER role; the bootstrap admin then assigns roles (PUBLISHER, REVIEWER,
PLATFORM_ADMIN), bee levels and status per account from the admin user
console (`/api/v1/admin/users`, wired into the Web admin view). Register
promptly after exposing the site — on an empty instance, whoever registers
first becomes admin.

## WAF on a separate host

The app ports already publish on all interfaces by default, so a WAF on its
own server can reach them out of the box: point the WAF sites at
`http://<store-server-LAN-IP>:8080` and `:8090` (never 127.0.0.1 — that
would hit the WAF host itself). Because the ports are open to the network,
restrict them to the WAF's IP via the DOCKER-USER chain — plain ufw does
NOT filter Docker-published ports:

```sh
iptables -I DOCKER-USER -p tcp --dport 8080 ! -s <waf-ip> -j DROP
iptables -I DOCKER-USER -p tcp --dport 8090 ! -s <waf-ip> -j DROP
# persist: apt install iptables-persistent && netfilter-persistent save
```

Prefer the ports not answer the LAN at all when the proxy is co-located?
Set `STORE_BIND_HOST=127.0.0.1` (and `MONITOR_BIND_HOST`) in `.env`. The
forwarded-header trust needs no change either way: a WAF hop from a private
address is covered by the default internal-proxies.

## Static assets on Cloudflare Pages

Optional, recommended when the site is published through Cloudflare (as
`www.infinia.fyi` is): first-visit 522s on `/assets/**` come from Cloudflare
having to fetch every static file from the origin over a flaky
edge→origin link — made permanent there by a zone cache rule that returns
`cf-cache-status: BYPASS` for static files. Offloading the SPA's hashed
assets to a Cloudflare Pages project removes them from that path entirely:
Pages serves `/assets/*` worldwide without contacting the store host. The HTML shell and the API keep coming from
the origin exactly as before, and the whole mechanism is opt-in — with
`ASSETS_BASE_URL` unset, nothing changes for any deployment.

Setup (one-time, one command):

```sh
scripts/deploy-assets.sh --all --fresh-project   # only for a NEW, empty Pages project
```

`--all` does everything in order: interactive configuration when values are
missing (saved to `deploy.conf`), build & publish (auto-detects the host: on
the store host it extracts the SPA from the freshly built image's jar;
anywhere else it builds in a throwaway node container from the same
lockfile), attaches the custom domain via the Cloudflare API, waits until
the domain actually serves the files, and switches the store container after
its health check. On a non-store host it does everything except the switch
and prints the final command to run on the server.

Once `ASSETS_BASE_URL` is active in `.env`, `scripts/upgrade.sh` builds the
next image, publishes its exact embedded SPA, and verifies the entry bundle's
bytes at the assets domain **before switching containers**. Publish or
verification failures trigger rollback. Cloudflare credentials can come from
the environment or `deploy.conf`; missing credentials fail the upgrade rather
than silently leave a new shell pointing at missing assets.

**Monitor host** (split deployment): the same offload covers the monitor SPA,
in whichever layout that host's `ASSETS_BASE_URL` names — the shape of the URL
picks it, and because the base is baked into the jar's shell at image-build
time (Vite `base`), moving the monitor to a different assets origin always
ends with a rebuild + `--switch`, never just a re-publish:

- **Dedicated project/domain** — a bare domain, e.g.
  `https://status-assets.example.com` on Pages project
  `infinia-monitor-assets`. The dist publishes as-is at the project root;
  nothing else lives there, so publishes can never disturb the store's half.

  ```sh
  scripts/deploy-assets.sh --monitor --configure   # ASSETS_BASE_URL=https://status-assets.example.com
                                                   # ASSETS_PAGES_PROJECT=infinia-monitor-assets
  scripts/deploy-assets.sh --monitor --all
  ```

- **Shared /monitor subtree** — a domain with a path, e.g.
  `https://asset.example.com/monitor` on the store's `infinia-assets`
  project. Each publish stages the monitor under `/monitor` with a shared
  root `_headers` (CORS for both `/assets/*` and `/monitor/assets/*`); the
  other half of the tree survives through the manifest retention below.

  ```sh
  scripts/deploy-assets.sh --monitor --configure   # ASSETS_BASE_URL=https://asset.example.com/monitor
                                                   # ASSETS_PAGES_PROJECT=infinia-assets (shared)
  scripts/deploy-assets.sh --monitor --all
  ```

`--project` or `ASSETS_PAGES_PROJECT` overrides the layout's default project.
The CI-published GHCR monitor image builds without the asset origin
(same-origin), so an offloaded monitor builds locally. The script records the
published image in `.monitor-release.yml` for cutover; `upgrade.sh --monitor`
likewise publishes and byte-verifies the next image's SPA before switching.

**Retaining files and migrating existing deployments**

Pages replaces the entire production tree on each publish. Every full run now
ships `infinia-assets-manifest.json`, listing all static files and SHA-256
checksums. Original HTML shells are embedded in the manifest because Cloudflare
may inject scripts into HTML responses. The next run downloads the previous manifest and retains its files,
including both HTML shells, lazy JavaScript chunks, fonts, and older hashed
bundles. Current build files take precedence. A missing manifest, failed
download, or checksum mismatch stops publication rather than dropping files.
Serialize publishes from the two hosts: Pages does not merge concurrent uploads.

An existing deployment created by the old script has no manifest. For its
**first migration**, supply a local copy of the **complete previous Pages tree**,
with the store at the root and monitor under `monitor/` if sharing a project:

```sh
scripts/deploy-assets.sh --all --previous-dist /path/to/complete-previous-pages-tree
# On the monitor host instead:
scripts/deploy-assets.sh --monitor --all --previous-dist /path/to/complete-previous-pages-tree
```

Use saved deployment output, or extract the static directories from the exact
previous store and monitor JARs and combine them in that layout. Include older
bundles you still need for rollback. Downloading just HTML and its entry script
is insufficient: it omits lazy imports. If the old script already removed
files, recover them from saved builds; the live domain cannot restore them.
After the first migration, omit `--previous-dist`. Use `--fresh-project` only
for an empty project; it intentionally skips retention. When adding a monitor
to an existing shared project, **do not** use `--fresh-project`.

`--dist DIR` remains a publish-only operation for a **complete project tree**;
it generates a manifest but does not merge remote files or infer `/monitor`.
Do not pass only one SPA's dist when replacing a shared project. Full builds
use a separate staging directory so the other SPA's files never contaminate
`store-web/dist` or `monitor-web/dist`.

Node is used for manifests (locally, or through the configured Node Docker
image). Custom domain attachment uses the [Pages Domains API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/); verify the domain's
CNAME/DNS record in Cloudflare if provisioning does not complete. A 200 HTML SPA
fallback is not a successful bundle probe; `--wait-assets` verifies actual bytes.

The manual equivalent, step by step:

1. **Pages project + domain** — the zone is already on Cloudflare. Publish the
   current SPA once, from whichever host is convenient:

   **From a dev machine** (needs Node/npx):

   ```sh
   ASSETS_BASE_URL=https://assets.example.com yarn web:build
   CLOUDFLARE_API_TOKEN=<token with Cloudflare Pages · Edit> \
   CLOUDFLARE_ACCOUNT_ID=<account id> \
   PAGES_INIT=1 ASSETS_PAGES_PROJECT=infinia-assets \
     scripts/deploy-assets.sh --dist store-web/dist
   ```

   **From the store host** (Docker-only; publishes the exact files the next
   jar will embed, so hashes cannot drift). The old container keeps serving
   until the final `up -d`:

   ```sh
   cd /opt/infinia-store
   echo 'ASSETS_BASE_URL=https://assets.example.com' >> .env
   docker compose --profile app build store
   # Extract the SPA out of the freshly built image's jar:
   docker create --name web-extract infinia-webservice
   docker cp web-extract:/app/InfiniaWebService.jar /tmp/web.jar
   docker rm web-extract
   rm -rf /tmp/pages-dist && mkdir -p /tmp/pages-dist
   cd /tmp/pages-dist && unzip -q /tmp/web.jar 'BOOT-INF/classes/static/*' \
     && mv BOOT-INF/classes/static/* . && rmdir BOOT-INF/classes/static BOOT-INF/classes BOOT-INF
   # (no unzip on the host? apt-get install -y unzip)
   cd - >/dev/null
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
   PAGES_INIT=1 scripts/deploy-assets.sh --dist /tmp/pages-dist
   # Optionally speed up the in-container wrangler download on China hosts:
   #   export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
   ```

   Then bind the custom domain (e.g. `assets.infinia.fyi`) in the Pages
   project settings — the DNS record is created for you. On the store host,
   finish the switch after verifying the domain serves the files:

   ```sh
   docker compose --profile app up -d   # no --build: image is already built
   ```
2. **Server `.env`** — set the same `ASSETS_BASE_URL=https://assets.infinia.fyi`
   and redeploy (`docker compose --profile app up -d --build`). Bootstrapped
   from the store host with `--all`? This already happened in step 1 (`.env` +
   build + `up -d`) — the script verifies the assets domain answers before
   that final switch: the shell references the domain from then on.

Full publishes retain hashed files listed in the previous manifest, so a
rollback keeps finding those bundles. Retention starts with the complete tree
provided during migration; previously deleted files are not recoverable from
Pages automatically. Monitor the growing tree against Pages file limits. Billing: Pages serves static assets with
unlimited requests and bandwidth on the free plan; the paid items to avoid
are unrelated (Argo, Workers paid).

This offload does not cache the HTML shell itself. If the shell also
flashes 522 on first visit, additionally remove the zone's bypass-cache rule
and stop the WAF from setting its `sl-session` cookie on static responses —
with assets on Pages that only affects the single HTML document.

## Backups

`scripts/backup-stack.sh <dir>` snapshots PostgreSQL (pg_dump), the MinIO
`store-blobs` bucket (mc mirror) and the store's JWT key files. Schedule it
from cron and copy the output off-host:

```cron
30 3 * * * root cd /opt/infinia-store && KEEP_DAYS=14 ./scripts/backup-stack.sh /mnt/backups/infinia
```

Restore:

```sh
gunzip -c <dir>/store.sql.gz | docker compose exec -T postgres psql
# blobs: from any mc host: mc alias set dst http://<host>:9000 ... ; mc mirror <dir>/store-blobs dst/store-blobs
# keys:  docker compose cp <dir>/keys store:/var/lib/infinia-store/keys/
```

The JWT keys are the deployment's secret store for access tokens — treat their
backups like passwords and keep an offline copy. Rotation = generate a new RSA
pair, swap the two files in the volume, restart the store (invalidates all
outstanding tokens).

## Upgrades

Automated (recommended): configure the CI deploy job once and every green
push to `main` deploys itself — see "Automated deploys" below. By hand:

Store host:

```sh
git pull && docker compose --profile app up -d --build
```

Monitor host (image pull only — no rebuild):

```sh
git pull && docker compose -f docker-compose.monitor.yml pull \
  && docker compose -f docker-compose.monitor.yml up -d
```

`scripts/upgrade.sh` automates the store-host command safely (pinned commit,
health wait, automatic rollback) and is what CI invokes.

Flyway migrations (`store-infrastructure/src/main/resources/db/migration`) run
automatically on boot. Schema changes are additive per release; check
CHANGELOG.md before jumping major versions.

## Automated deploys

`ci.yml` ends with a `deploy` job: once `backend`, `frontend` and `images`
are green on a push to `main` (or a manual *Run workflow* dispatch), it SSHes
into the production host(s) and runs `scripts/upgrade.sh` pinned to the exact
commit — checkout, `docker compose --profile app up -d --build`, health wait,
and an automatic rollback to the previous image + checkout if the store does
not come back healthy. Deploys queue behind each other (never cancel
mid-deploy), `.env` is never touched, and runs appear under the repo's
*Environments → production* tab. The optional monitor host (split deployment)
updates by GHCR image pull in the same run. Self-hosted CI? The same upgrade
ships as a Jenkins pipeline — "Jenkins instead of GitHub Actions" below.

### One-time setup

1. **Server** — the repo cloned at the deploy path with `.env` in place
   (i.e. what `scripts/deploy.sh` leaves behind), plus credentials for an
   unattended `git fetch origin`: add a read-only
   [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
   (`ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_deploy`, paste the `.pub`
   into the repo's Settings → Deploy keys) or an HTTPS credential helper.
   The SSH user must be root or allowed to `sudo -n` (passwordless).
2. **CI key pair** — a separate key for the runner:
   `ssh-keygen -t ed25519 -N '' -f ci_deploy`, then append `ci_deploy.pub` to
   the server's `~/.ssh/authorized_keys`. (No root shell? Give the CI user
   passwordless sudo for `scripts/upgrade.sh` only.)
3. **Repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Required | Meaning |
   |---|---|---|
   | `DEPLOY_SSH_HOST` | yes | store host (IP or DNS); unset disables deploys entirely |
   | `DEPLOY_SSH_PRIVATE_KEY` | yes | contents of the `ci_deploy` private key |
   | `DEPLOY_SSH_USER` | no | default `root`; any user with passwordless sudo |
   | `DEPLOY_SSH_PORT` | no | default `22` |
   | `DEPLOY_PATH` | no | repo path on the host, default `/opt/infinia-store` |
   | `DEPLOY_KNOWN_HOSTS` | no | `ssh-keyscan -p <port> <host>` output; without it the first connection is trusted on first use |
   | `DEPLOY_MONITOR_SSH_HOST` | no | monitor host (split deployment); needs Docker access for its SSH user (root or the `docker` group) |
   | `DEPLOY_MONITOR_*` | no | per-host `USER`/`PORT`/`PRIVATE_KEY`/`KNOWN_HOSTS`/`PATH`; default to the store host's values |

4. Optional gate — *Settings → Environments → production → Required
   reviewers* turns every deploy into a one-click approval.

### Jenkins instead of GitHub Actions

The repo ships a root `Jenkinsfile` with the same shape: backend verify and
frontend tests/builds run in stage containers (Maven/JDK 21, Node 22 — the
agent itself only needs Docker), and a green build of `main` deploys through
the very same `scripts/upgrade.sh`. Prefer it when the server should not be
reachable from GitHub runners, or you want self-hosted CI.

Setup:

1. Jenkins with the **Pipeline**, **Docker Pipeline** and (for remote
   deploys) **SSH Agent** plugins; the agent needs Docker — `deploy.sh`
   already configured registry mirrors on the production host, so the stage
   images pull fine. Containerized Jenkins must mount the host Docker
   socket and carry the docker CLI, or the `docker`-agent stages cannot
   start sibling containers (first-boot unlock password:
   `docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword`):

   ```sh
   # port 8888: the store already owns the host's 8080
   docker run -d --name jenkins --restart unless-stopped \
     -p 8888:8080 -p 50000:50000 \
     -v jenkins_home:/var/jenkins_home \
     -v /var/run/docker.sock:/var/run/docker.sock \
     jenkins/jenkins:lts-jdk21
   # docker CLI inside (one-off, Aliyun repo):
   docker exec -u root jenkins bash -c '
     apt-get update && apt-get install -y -q ca-certificates curl &&
     install -m 0755 -d /etc/apt/keyrings &&
     curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/debian/gpg -o /etc/apt/keyrings/docker.asc &&
     echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.aliyun.com/docker-ce/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list &&
     apt-get update && apt-get install -y -q docker-cli'
   ```
2. New item → Pipeline: SCM = this repo, script path `Jenkinsfile`,
   branch `*/main` (or a multibranch job). The deploy gate accepts both
   the regular Pipeline SCM branch and multibranch `BRANCH_NAME`. The pipeline polls SCM every ~5 minutes out of the
   box; prefer a GitHub webhook for instant builds and then delete the
   `triggers` block so one push doesn't queue two builds.
3. Edit the `environment` block at the top of the `Jenkinsfile` once:
   - Jenkins on its own host — set `PROD_HOST` / `PROD_USER` / `PROD_PATH`,
     and add the deploy key as an "SSH Username with private key" credential
     named `infinia-prod-deploy` (the same key pair as the GitHub Actions
     setup above; the server's `authorized_keys` already has it).
   - Jenkins on the production host — leave `PROD_HOST` empty and grant the
     `jenkins` user passwordless sudo for the upgrader only:

     ```sudoers
     jenkins ALL=(root) NOPASSWD: /opt/infinia-store/scripts/upgrade.sh
     ```

     root must then be able to `git fetch` the checkout — same deploy-key
     note as the GitHub Actions setup, installed for root's `~/.ssh`.

The two CI systems coexist independently: GitHub Actions deploys only when
its `DEPLOY_*` secrets are set, so leave them unset once Jenkins owns the
deploys.

The split-host Jenkins deploy builds the monitor from the same commit as the
store using `scripts/upgrade.sh --monitor`, so it does not depend on GitHub
Actions publishing `latest`. It waits for container health and checks the
image revision label. The host-local `.monitor-release.yml` override selects
that commit's image; on failure the script restores the previous checkout
and image. For subsequent manual Compose operations on this monitor host,
include both files:

```sh
docker compose -f docker-compose.monitor.yml -f .monitor-release.yml ps
sudo bash scripts/upgrade.sh --monitor --path "$PWD" --ref origin/main
```

The Jenkins deployment credentials are `infinia-prod-deploy` and
`infinia-monitor-deploy`. Keep private keys in Jenkins credentials, never in
Git. The controller's Docker CLI may be installed under its persistent
`/var/jenkins_home/tools/docker` directory; add this directory to the node's
`PATH+DOCKER` environment property if the container has no system Docker CLI.

### Public download trust artifact

After a production deploy, Jenkins verifies the persisted Ed25519 private key
against the active public key in PostgreSQL and archives `trusted-store-keys.json`.
`scripts/export-store-trust.py` runs on the store host with Python 3, OpenSSL and
Docker Compose; its stdout contains only public material and a signed challenge.
The existing deployment account must already have permission to run this check
with sudo. Do not grant broad sudo access solely for this step; on restricted
installations have the operator run the exporter instead.

The exporter pins the SHA-256 fingerprint of the production X.509 DER public key:
`8b694d02cf8e7597e3ce8a494c9f1dd544ebbda33cb74bea5944fe830920668f`.
A changed key, multiple active keys or missing private key fails the export;
review rotation and update host trust before changing the pin. Existing keys are
never regenerated by this step. It includes platform keys marked `REVOKED` in
the runtime overlay's revocation list.

Provision the public artifact as `<runtime-root>/trusted-store-keys.json` on an
existing FengYu host, merging any operator keys/revocations, then restart its
backend. New host builds bundle the production key. Keep
`fengyu.store.require-signature=true` and use `https://www.infinia.fyi` as the
store API base. This is artifact signing trust, separate from HTTPS certificates.
Never archive or distribute the server's private `.b64` file.

### Notes

- **Rollback**: `scripts/upgrade.sh` snapshots the running image as
  `infinia-webservice:rollback` and restores it automatically when the new version
  fails its health check. Manual rollback: `git checkout <previous-rev>`,
  `docker tag infinia-webservice:rollback infinia-webservice:latest`,
  `docker compose --profile app up -d --no-build`.
- The upgrade pins an exact commit with `git checkout -f`: server-side edits
  to tracked files are silently reverted. Keep host-specific settings in
  `.env` (untracked), never in tracked files.
- **Server not reachable from GitHub runners** (NAT, firewall)? Skip the
  secrets and drive the same script from a server-side timer instead —
  root's crontab, every 10 minutes:

  ```cron
  */10 * * * * root cd /opt/infinia-store && git fetch -q origin && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && ./scripts/upgrade.sh >> /var/log/infinia-upgrade.log 2>&1
  ```

## Image pinning notes

- `postgres:17-alpine` / `redis:7-alpine`: major-pinned, as shipped.
- `minio/minio`: pinned to `RELEASE.2025-09-07T16-13-09Z-cpuv1` — the final
  official image (MinIO discontinued prebuilt images; `latest` is frozen).
  Verify on the host (`docker manifest inspect minio/minio:<tag>`) and
  re-evaluate against MinIO's source releases when adopting a newer server.
- CI builds and publishes `ghcr.io/<repo>` (store) and `ghcr.io/<repo>-monitor`
  on every push to `main`; pin by digest in `.env`-driven overrides if you
  prefer immutability over `--build`.

## Status page live stream (SSE)

The status page updates live over `GET /api/v1/status/events` (Server-Sent
Events, served by the monitor only — never the store): a snapshot on connect,
then `component.updated` / `incident.updated` / `history.updated` events as
confirmed changes land. Comment-only heartbeats fire every 15 s and the server
sends `X-Accel-Buffering: no`, but the reverse proxy must cooperate:

- **SafeLine (monitor site)** — response buffering must be off for the events
  route (the `X-Accel-Buffering: no` response header does this for
  nginx-family upstreams; verify in the site's advanced config), the proxy
  read timeout must sit comfortably above the 15 s heartbeat (≥ 60 s
  recommended), and CC protection must not cap concurrent long-lived
  connections from one IP — several open dashboard tabs are several held
  connections by design. The page tolerates a broken stream: it shows
  重连中 (reconnecting), retries with exponential backoff, and falls back to
  30 s polling when the stream is unavailable (a full connection cap answers
  503 on purpose).
- **Cloudflare zone** (if the status domain is proxied) — the events route
  must stay out of any cache rule (the zone already BYPASSes `/api/v1/status`
  — keep the `/events` suffix covered too). Cloudflare's ~100 s idle timeout
  is safely above the 15 s heartbeat.
- **Connection bounds** — the monitor caps concurrent streams
  (`MONITOR_SSE_MAX_CONNECTIONS`, default 200) and keeps a bounded replay
  buffer (`MONITOR_SSE_REPLAY_CAPACITY`, default 1000 events); a dead client
  is dropped on its first failed send and recovers via snapshot on reconnect,
  so slow clients cannot pin memory.

### Acceptance drill (after deploying the real-time stack)

Verify on the production status page, in this order:

1. **Fault appears in time** — stop the store (`docker compose stop store` on
   the store host): within ~10 s the external component shows 确认中
   (confirming), within ~15 s confirmed red, and the incident opens after
   confirmation. No page reload needed.
2. **Recovery is deliberate** — start the store again: after two confirmed
   probe rounds the page returns to green and the incident resolves.
3. **A dropped connection never fakes normal** — cut the browser's network
   (offline mode): the chip shows 连接中断 (connection lost), the last data
   stays with an as-of timestamp, and past the 3-minute validity window it is
   flagged stale rather than passing as live.
4. **Reconnect loses nothing** — restore the network: backoff reconnect,
   missed events replay (no full-page flash), state consistent.
5. **Monitor restart** — `docker compose -f docker-compose.monitor.yml
   restart`: the client reconnects and receives a fresh snapshot (event ids
   reset with the process, by design).
6. **Proxy soak** — leave tabs open for hours; the heartbeat keeps streams
   alive and the monitor's memory stays bounded.
7. **Statistics did not change meaning** — old history days keep the
   采样统计 (sampled statistics) mark; new days show coverage in the day
   detail; a fully-observed outage day reads 0% with coverage, not "100%".

## Operational limits & knobs

- Resource ceilings per service: `DOCKER_CPUS_LIMIT` / `DOCKER_MEM_LIMIT`
  (defaults 2 CPUs / 1 GiB). The JVM sizes its heap from the container limit
  (`-XX:MaxRAMPercentage=75`).
- Container logs rotate at 10 MiB × 3 files (`json-file` driver) — set a log
  shipper on `/var/lib/docker/containers` if you need central aggregation.
- Alerting: `MONITOR_ALERT_WEBHOOK` (opt-in) receives state-change alerts from
  the monitor.

### Unified frontend

The store (`/store`) and introduction (`/`) are one React/Vite project in `store-web`.
`yarn web:build` produces the only frontend bundle consumed by InfiniaWebService.
There is no separate Next.js export, port 3100, or `NEXT_PUBLIC_*` configuration.
The independent monitor remains a separate application.

Store pages live under `/store/*`. Legacy store links and `/callback` forward through the SPA, preserving query parameters; `/site` redirects to `/`. The registered OAuth callback URI remains unchanged. The introduction is now client-rendered, rather than a separate Next.js static export.
