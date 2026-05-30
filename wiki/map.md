# Map

> **Status: stub.** Filled in when the map is authored (phase 2). See
> [[workflows]].

The game board is an **original** route network over real United States cities
(geography is fact; the route graph is our own — see [[design-decisions]]). Data
lives in `src/engine/map.js` as `MAP` and `TICKETS`, in the format specified by
`CONTRACT.md` §2 and validated by `tools/validate-map.js`.

To be documented here once authored: city list, route count and length/color
distribution, ticket count and value range, and the rendered board image. See
[[game-rules]] for how routes and tickets are used, and [[scoring]] for points.
