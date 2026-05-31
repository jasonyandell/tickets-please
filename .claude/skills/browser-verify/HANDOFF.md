# In-progress handoff — browser-verify skill + the render bug

**Goal (from Jason):** add Playwright; the board "isn't rendering" (should be a
playable area). Build it as a **self-improving skill** in the gomoku style
(SKILL.md + log.md + a mandatory self-improvement/friction-log step that the skill
edits itself on each blocker). Methodology = Sid Bidasaria talk: verification loop
→ package as skill → skill documents itself. Framing: not "make no mistakes" but
"use skill S to accomplish X, measured by Y".

## THE RENDER BUG (root cause, found by static analysis)
- `src/ui/main.js` calls `getElementById("map")` for the canvas (and `"panel"`).
- BUT `src/ui/index.html` (which I rewrote during the deploy step) gives the
  canvas `id="board"`, not `id="map"`. → canvas ref is null → renderer no-ops →
  blank playable area. THIS is the "not rendering" symptom.
- **FIX:** in `src/ui/index.html`, the `<canvas>` id must be `map` (match main.js).
  Verify main.js around lines 100-145 for the exact `getElementById` calls and any
  other ids it needs (it also uses `panel`; index.html already has `id="panel"` ok).
- After fixing, also run `npm run build` is NOT needed for local serve; the e2e
  server (`tools/serve.js`) serves repo root and maps `/` → `src/ui/index.html`.

## STATE OF FILES (already created)
- `.claude/skills/browser-verify/SKILL.md` — the skill (done).
- `.claude/skills/browser-verify/log.md` — empty log, append a dated entry after a run.
- `playwright.config.js` — port 8788, webServer = `node tools/serve.js 8788`, testDir ./e2e.
- `e2e/board.spec.js` — asserts: no pageerror/console.error; a `<canvas>` exists and
  has >3 distinct sampled colors (not blank); `#panel` populated; saves
  `artifacts/board.png`.
- `.gitignore` — added artifacts/, test-results/, playwright-report/ (done).
- Playwright + chromium INSTALLED (npm i -D @playwright/test, exit 0).

## STILL TO DO
1. **Re-add `"test:e2e": "playwright test"` to package.json scripts** — a linter
   reformatted package.json and dropped my edit. Current scripts: test, test:watch,
   serve, validate, build, deploy. (devDependencies already has @playwright/test.)
2. (Optional, demonstrates the loop) Run `npm run test:e2e` BEFORE the id fix to
   see it go RED with the real DOM evidence.
3. Fix the canvas id in index.html (board → map).
4. Run `npm run test:e2e` → GREEN. Confirm `artifacts/board.png` shows the board.
   LOOK at the screenshot (SendUserFile) — green assertions + blank PNG = weak Y.
5. **Self-improve:** append a dated entry to the skill's log.md (what ran, the
   error text, the fix, what surprised you — log failures loudest). Tighten the
   SKILL/Y if a green run produced a bad screenshot.
6. Commit (verify green BEFORE committing — see memory verify-before-commit) and
   `git push origin main` (repo: github.com/jasonyandell/tickets-please; live:
   https://tickets-please.jasonyandell.workers.dev). The push triggers CI deploy;
   e2e is NOT in CI (kept local/dev-only; shipped game stays zero-dep).

## KEY MEMORY / CONVENTIONS
- verify-before-commit: never batch a commit with its gating test run; verify, then commit.
- beads is gone; tool channel healthy. Bleed/garbled output can recur from stray
  background node procs — `pkill -9 -f "node --test"` if output looks duplicated.
- Engine is a pure deterministic reducer; 87 unit tests pass via `npm test`.
- Methodology going forward: teach → extract skill → validate → self-improve → measure.
