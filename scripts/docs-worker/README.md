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

## One-time setup (steps that need your credentials)

The FengYu commit that carries the pipeline is staged locally at
`/tmp/fengyu-main` (a worktree of `~/Develop/Java/FengYu`, branch `main`,
commit `bb2d3328`). **Do step 1 before pushing it** — pushing while Pages is
still in legacy mode would overwrite the live VitePress mirror with raw
markdown sources.

### 1. Switch FengYu GitHub Pages to Actions deployments (blocks the push)

GitHub → MuskStark/FengYu → Settings → Pages → Build and deployment →
Source: **GitHub Actions**. (The REST PATCH needs a token with Pages write;
the web UI is the one-liner.)

### 2. Create the Pages project and bind docs.infinia.fyi

```sh
CLOUDFLARE_API_TOKEN=<token with Pages:Edit> CLOUDFLARE_ACCOUNT_ID=<id> \
  npx wrangler pages project create infinia-docs --production-branch=main
```

Then dashboard → Workers & Pages → infinia-docs → Custom domains →
`docs.infinia.fyi` (zone infinia.fyi; the CNAME is added automatically).
Prefer the custom domain over `*.pages.dev` — reachability from CN.

### 3. Deploy this Worker

```sh
cd scripts/docs-worker && npx wrangler deploy
```

Adds the route `www.infinia.fyi/docs*` on the infinia.fyi zone.

### 4. FengYu repo secrets + enable flag

```sh
gh secret set CF_PAGES_TOKEN -R MuskStark/FengYu    # same Pages:Edit token
gh secret set CF_ACCOUNT_ID  -R MuskStark/FengYu
gh variable set CF_PAGES_ENABLED -R MuskStark/FengYu --body true
```

The `publish-infinia` job stays skipped until the flag exists, so a push
before this step doesn't go red.

### 5. Push FengYu main and verify

```sh
cd /tmp/fengyu-main && git push origin main
gh run watch -R MuskStark/FengYu          # Docs: build ✓ deploy ✓ publish-infinia ✓
curl -fsSI https://www.infinia.fyi/docs/ | head -1
```

(The worktree can be cleaned up afterwards:
`git -C ~/Develop/Java/FengYu worktree remove /tmp/fengyu-main`.)

### 6. Publish the website link switch

`store-web/src/intro/site/config.ts` already points every docs link at
`/docs/...` (committed locally in this repo). Build & publish the SPA through
the normal flow only AFTER step 5 answers 200, so no visitor hits a dead
"Docs" button mid-rollout.

## Notes

- GitHub Pages (`muskstark.github.io/FengYu`) keeps working as a mirror via
  the original build/deploy jobs; the official site no longer depends on it.
- The main-branch `CHANGELOG.md` is still at v3.2.0, so the docs' changelog
  page (regenerated from it on every build) shows v3.2.0 content until the
  4.x CHANGELOG lands on main.
- Check the zone's static-file cache rules don't cache HTML on
  `docs.infinia.fyi` — Pages defaults are fine (short HTML, long hashed
  assets); only an explicit "Cache Everything" rule would break freshness.
