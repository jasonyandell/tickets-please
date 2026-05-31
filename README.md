# tickets-please 🚂

A free, open-source, **public-domain** railway route game in the lineage of
*Ticket to Ride* — collect train cards, claim routes across the United States,
and complete secret destination tickets. **Zero dependencies.** Pure ES-module
engine that runs in Node *and* the browser.

**▶ Play it live: https://tickets-please.jasonyandell.workers.dev**

[![Deploy to Cloudflare](https://github.com/jasonyandell/tickets-please/actions/workflows/deploy.yml/badge.svg)](https://github.com/jasonyandell/tickets-please/actions/workflows/deploy.yml)

> Built live as a demonstration of **workflow-orchestrated development** with
> Claude Code — see [`wiki/workflows.md`](wiki/workflows.md). The `wiki/` is a
> first-class artifact: an LLM-maintained knowledge base. Start at
> [`wiki/index.md`](wiki/index.md).

## Play

```bash
npm run serve     # then open http://localhost:8080/
```

…or just open `src/ui/index.html` in a browser. (Available once the UI phase
lands — see the [build log](wiki/log.md).)

## Develop

```bash
npm test          # node --test over tests/  (zero dependencies)
npm run validate  # check the map against its invariants
npm run build     # assemble the deployable static site into dist/
```

## Deploy

Hosted free on **Cloudflare Workers** (static assets), auto-deployed on every
push to `main` via GitHub Actions (`.github/workflows/deploy.yml`): the workflow
runs the test suite + map validation, then builds `dist/` and publishes. Config
is in `wrangler.toml`. Manual deploy: `npm run deploy` (needs
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## How it's built

- **Engine** (`src/engine/`) — a pure, deterministic reducer:
  `applyAction(state, action) -> state`. No `Math.random`, no I/O. Same seed +
  same actions ⇒ identical game. See [`CONTRACT.md`](CONTRACT.md).
- **AI** (`src/ai/`) — heuristic opponents that emit the same actions a human
  would.
- **UI** (`src/ui/`) — a zero-dependency HTML5 Canvas board.
- **Wiki** (`wiki/`) — the project's living knowledge base.

## License

Public domain — [The Unlicense](LICENSE). Do anything you want with it.

*Ticket to Ride is a trademark of Days of Wonder. This is an independent,
public-domain implementation of the rules (which are not copyrightable) over an
original map. See [`wiki/design-decisions.md`](wiki/design-decisions.md).*
