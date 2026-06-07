# Deployment

`tickets-please` is hosted free on **Cloudflare Workers** (static assets) and
**auto-deploys on every push to `main`** via GitHub Actions.

- **Live:** https://tickets-please.jasonyandell.workers.dev
- **Repo:** https://github.com/jasonyandell/tickets-please

## How it works
The app is plain ES modules with no bundler, but its entry (`src/ui/index.html`)
isn't at the repo root and imports `../engine/` and `../ai/`. So a tiny zero-dep
build assembles a servable tree:

- `tools/build.js` → writes `dist/`: the whole `src/` tree copied to `dist/src/`,
  plus a root `dist/index.html` derived from `src/ui/index.html` with its
  `./main.js` / `./style.css` references repointed at `./src/ui/`. Every relative
  import inside the app is preserved, so `/` serves the game. It also emits a
  `dist/_headers` (the cache policy below). See [[architecture]].
- `wrangler.toml` serves `dist/` as Workers static assets (`name = tickets-please`).

## Cache policy (`dist/_headers`)
Tuned for the persist + reload loop ([[ui]]): a reload should pick up freshly
deployed code while the deterministic [[ui|save (seed + action tape)]] restores the
exact game position. `tools/build.js` writes a `_headers` file:

- `/` and `/index.html` → `Cache-Control: no-cache` — the HTML shell is always
  revalidated, so a ⟳ Reload (manual or the chill auto-reload) gets the latest app.
- `/src/*` → `Cache-Control: public, max-age=300` — the ES modules cache for 5
  minutes (fast repeat loads), short enough that a deploy propagates promptly.

This pairs with the in-app **chill auto-reload** ([[ui]]): within 5 min of a move
the page reloads every ~30s, so an open tab quietly upgrades to a new deploy.

## CI/CD (`.github/workflows/deploy.yml`)
On push to `main` (or manual `workflow_dispatch`):
1. **test** job — `npm test` (205 tests) + `npm run validate` (map invariants).
2. **deploy** job (`needs: test`) — `node tools/build.js`, then
   `cloudflare/wrangler-action@v3` publishes with repo secrets
   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

So a broken build or a failing test blocks the deploy. See [[testing]].

## Manual deploy
```bash
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
export CLOUDFLARE_ACCOUNT_ID=$(security find-generic-password -s cloudflare-account-id -w)
npm run deploy        # = node tools/build.js && wrangler deploy
```

## Notes
- Zero runtime dependencies; the only dev-time tool is `wrangler` (via `npx`).
- ES modules require the correct `text/javascript` MIME — Cloudflare's static
  assets serve `.js` correctly (verified live).
- Bumping content: just push to `main`; the edge picks up the new version.
