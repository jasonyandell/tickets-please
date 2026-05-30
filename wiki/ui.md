# UI

> **Status: stub.** Filled in when the renderer is built (phase 4). See
> [[workflows]].

The UI is a zero-dependency HTML5 **Canvas** renderer plus input handling in
`src/ui/`. It draws the [[map]] (cities, routes, claimed trains), the player's
hand and the face-up row, scores, and the current destination tickets, and turns
clicks into [[engine-api|actions]] fed to the reducer. AI turns are driven by
[[ai]]. To be documented: controls, layout, and how to launch
(`src/ui/index.html` / `npm run serve`).
