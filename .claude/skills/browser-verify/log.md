# browser-verify — run log

Append-only. Newest at the bottom. **Read this before each run.** Log failures
loudest — they are the signal that saves the next run.

---

### 2026-05-30 — first run: caught the "board not rendering" bug
- **Ran:** `npm run test:e2e` against `src/ui/` served by `tools/serve.js`.
- **RED (as designed):** `pageerror: TypeError: Cannot read properties of null
  (reading 'getContext')`. Root cause: `src/ui/main.js:108` does
  `getElementById('map')` for the canvas (and `style.css` targets `#map`), but
  `src/ui/index.html` had given the canvas `id="board"` (introduced during an
  unrelated deploy-time rewrite). Null canvas → `.getContext` throws at module
  load → the whole page is blank. This is exactly the symptom "there should be a
  playable area but it isn't rendering."
- **Fix:** `index.html` canvas `id="board"` → `id="map"`. One line.
- **GREEN:** 1 passed; `artifacts/board.png` shows the US map with colored route
  segments, labeled cities, and a populated side panel. Y held (canvas has many
  distinct colors; panel non-empty).
- **What surprised me / FRICTION (fixed):**
  1. **Bare `npx playwright test` did NOT load `playwright.config.js`** — it
     reported "No tests found" and used the repo root as the default testDir.
     Passing `-c playwright.config.js` fixed it. The `test:e2e` script now bakes
     in `-c playwright.config.js` so this can't recur. (Suspected ESM
     `"type":"module"` config-discovery quirk; the explicit flag is the robust
     fix — don't rely on auto-discovery here.)
  2. The bug was invisible to all 87 Node unit tests — a null DOM ref only fails
     in a real browser. This is the entire reason browser-verify exists: **a UI
     "done in the code" is not done until a browser proves it.**
- **Skill change earned this run:** none to Procedure/Y (they worked first try);
  the `-c` flag friction is captured in the `test:e2e` script + this log so the
  next run starts knowing it.
