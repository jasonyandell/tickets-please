---
name: browser-verify
description: Prove a browser UI actually renders and is interactive using Playwright — don't claim "it works", screenshot it and assert on the live DOM/canvas. Use when the user says the page "isn't rendering", "is blank", "verify the UI", "does it actually work in a browser", or after any change to src/ui/.
---

# browser-verify

A web UI that "looks done in the code" is not done. JS modules fail silently —
one null element ref at module load blanks the whole page and nothing in Node's
unit tests will catch it. This skill makes the browser the source of truth:
launch the real app in a real browser, **prove** the playable area rendered, and
leave a screenshot as evidence. It is the forcing function that lets us stop
eyeballing the page.

> **Integrity rule (load-bearing — this skill was born from violating it):**
> Record and report ONLY what you OBSERVED in this run. Never write the predicted
> error, the predicted fix, or "it renders" before you've seen the green run AND
> looked at the screenshot. A green assertion with an unseen screenshot is not a
> pass. Verify, THEN commit (never batch the commit with the gating run).

> **Serve the SHIPPED artifact, not source.** Point the e2e server at the built
> output (here `dist/`, via `tools/serve.js <port> dist`), so the test exercises
> the exact files prod serves. Serving raw `src/` hid a real 404 (relative asset
> paths resolved differently at `/` than in prod) — see log.md 2026-05-30.

## When to use
- The user reports the page is blank / not rendering / "should be a playable area".
- After ANY change to `src/ui/` (`index.html`, `main.js`, `render.js`, `layout.js`).
- Before claiming a UI change works. Claiming without this is the mistake.

## Procedure
1. **Read `log.md` in this skill dir first.** Past runs record the exact failure
   modes (id mismatches, module-load throws, canvas-blank-but-no-error). Walk in
   knowing them.
2. **Ensure Playwright is available:** `npx playwright --version`. If missing:
   `npm i -D @playwright/test && npx playwright install chromium`. (Dev-only —
   the SHIPPED game stays zero-dependency; Playwright is test tooling.)
3. **Run the verifier:** `npm run test:e2e`. It auto-starts the static server
   (`tools/serve.js`), loads the app, and asserts the Y below. It writes a
   screenshot to `artifacts/board.png` regardless of pass/fail.
4. **Read the failure like evidence, not noise.** A `pageerror` with a stack is
   the bug. A blank-canvas assertion with no console error means logic drew
   nothing (wrong coords / empty state), not a crash. They have different fixes.
5. **Fix the smallest thing** the evidence points to. Re-run step 3 to green.
6. **Look at the screenshot.** Green assertions + a blank-looking PNG = the
   assertion is too weak; strengthen it (that is the self-improvement job).

## Validation — the crisp Y (prove it, don't claim it)
`npm run test:e2e` must pass, and that means ALL of:
- **Zero `pageerror`s and zero `console.error`s** during load + New Game.
- The canvas the app draws on **exists** and **has non-trivial painted content**
  (sampled pixels show > 3 distinct colors — not a flat fill, not blank).
- The side panel is **populated** (has child elements / non-empty text).
- A **New Game** renders a board with at least one clickable route region.
- `artifacts/board.png` exists and visibly shows the board (final human check).

If you cannot produce the screenshot, you have NOT verified the UI.

## Self-improvement (MANDATORY — before reporting done)
Reflect on this run and EDIT THIS SKILL + append to `log.md`:
- Hit a failure mode not listed here? Add it to Procedure/Validation.
- Did a green run still produce a blank/wrong screenshot? The Y was too weak —
  strengthen the assertion so next time it would have failed. (This is the main
  way this skill gets sharp — make "I thought it worked" impossible.)
- Guessed at a selector/step? Replace it with the exact one that worked.
- Append a dated `log.md` entry: what you ran, what the screenshot showed, the
  failure (with the actual error text), the fix, and what surprised you. **Log
  failures loudest — the next run reads the log first.**
- Keep edits small and earned — each traceable to something that happened now.
