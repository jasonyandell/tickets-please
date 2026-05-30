# Wiki Schema & Maintenance Rules

This `wiki/` is a **first-class artifact** of the `tickets-please` project. It is
an LLM-maintained knowledge base in the style of Karpathy's "LLM wiki": a
persistent, interlinked layer of markdown that compounds as the project grows,
rather than being re-derived from the source on every question.

## The three operations

1. **Ingest.** Whenever code, rules, or design change, update the affected wiki
   pages *and* their neighbors (follow the `[[links]]`). Add a dated line to
   [[log]].
2. **Query.** Answer questions about the project from the wiki first, citing the
   page. If a good answer isn't a page yet, make it one.
3. **Lint.** Periodically check for contradictions, orphaned pages (nothing links
   to them), and gaps (referenced pages that don't exist). Record lint passes in
   [[log]].

## Files

- `index.md` — the catalog: every page, grouped by category, one line each.
- `log.md` — append-only chronological record of ingests, queries, and lints.
- `CLAUDE.md` — this file: how the wiki is maintained.
- Topic pages — one concept per page, named `kebab-case.md`.

## Conventions

- **Linking.** Reference other pages with `[[page-name]]` (no `.md`). Link
  liberally; a link to a not-yet-written page is a valid TODO marker.
- **One concept per page.** Keep pages focused; split when they sprawl.
- **Source of truth.** For *numbers and rules*, the code in `src/engine/` and
  `CONTRACT.md` are authoritative; wiki pages explain and cross-reference them,
  and must be corrected when they drift. For *intent and design rationale*, the
  wiki is authoritative.
- **Cite code** as `path:symbol` (e.g. `src/engine/scoring.js:longestPath`).
- **Date format.** ISO `YYYY-MM-DD`.
- Keep prose tight. This is a reference, not a narrative.
