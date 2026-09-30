# In-site docs at https://www.infinia.fyi/docs/

The FengYu docs are mounted as an in-site path of the official site instead of
hopping out to `muskstark.github.io/FengYu`:

```
FengYu main ──push──▶ docs.yml (publish-infinia job)
                        vitepress build --base=/docs/
                        wrangler pages deploy → project infinia-docs
                                                    │ custom domain
                                                    ▼
                       docs.infinia.fyi ◀── this Worker ◀── www.infinia.fyi/docs*
```

- **Source of truth**: FengYu `main` branch `docs/` (VitePress, en + zh).
  Every push touching `docs/**` or `CHANGELOG.md` rebuilds and republishes.
- **Why a separate Pages project**: Pages replaces the entire production tree
  on each publish — sharing `infinia-assets` with the store SPA's hashed files
  would evict them on every docs deploy.
- **Why `--base=/docs/`**: every internal link (nav, sidebar, locale switch,
  search index) carries the prefix, so the Worker forwards paths verbatim.

## Current status / what's left

- ✅ FengYu main carries the VitePress site + `docs.yml` (`build`, `deploy`,
  `publish-infinia` jobs all green). Push to main = docs rebuild.
- ✅ Pages project `infinia-docs` live at `https://docs.infinia.fyi/docs/`
  (en + zh, `--base=/docs/` build). Credentials live in the repo's
  **CloudFlare** GitHub environment (`CF_PAGES_TOKEN`, `CF_ACCOUNT_ID`).
- ⬜ The zone Worker (this directory) — `https://www.infinia.fyi/docs/` is
  404 until it exists. Deploy it ONE of these ways:
  1. **Via CI**: create a Cloudflare API token from the "Edit Cloudflare
     Workers" template + `Zone:Edit` on infinia.fyi, put it in THIS repo's
     `CloudFlare` environment as `CF_WORKERS_TOKEN` (plus `CF_ACCOUNT_ID`),
     then run the **Docs Worker** workflow (Actions → Docs Worker → Run
     workflow, or `gh workflow run "Docs Worker" -R MuskStark/infinia-store-platform`).
     Note: the FengYu-side `CF_PAGES_TOKEN` (Pages:Edit only) can't do this.
  2. **Via dashboard**: Workers & Pages → Create Worker (name
     `infinia-docs-frontend`) → paste `worker.js` → deploy → Settings →
     Domains & Routes → Add route `www.infinia.fyi/docs*`.
  3. **Locally**: `CLOUDFLARE_API_TOKEN=<workers token> npx wrangler deploy`
     in this directory.
- ⬜ After the Worker answers (`curl -fsSI https://www.infinia.fyi/docs/`
  → 200): publish the website SPA with the in-site `/docs` links through the
  normal build/deploy flow — the intro site's commit already switched every
  link in `store-web/src/intro/site/config.ts`.

## Completed setup log

- FengYu GitHub Pages switched to Actions deployments; the
  muskstark.github.io/FengYu mirror now rebuilds from main via `docs.yml`.
- FengYu main carries the VitePress migration (`bb2d3328`) plus the
  CloudFlare-environment wiring for the publish job (`6aa5830a`).
- FengYu's Cloudflare credentials live in the repo's **CloudFlare**
  environment (`CF_PAGES_TOKEN`, `CF_ACCOUNT_ID`); the repo-level
  `CF_PAGES_ENABLED=true` variable gates the publish job (job-level `if`
  can't see environment variables — hence repo scope).

## Notes

- GitHub Pages (`muskstark.github.io/FengYu`) keeps working as a mirror via
  the original build/deploy jobs; the official site no longer depends on it.
- The main-branch `CHANGELOG.md` is still at v3.2.0, so the docs' changelog
  page (regenerated from it on every build) shows v3.2.0 content until the
  4.x CHANGELOG lands on main.
- Check the zone's static-file cache rules don't cache HTML on
  `docs.infinia.fyi` — Pages defaults are fine (short HTML, long hashed
  assets); only an explicit "Cache Everything" rule would break freshness.
