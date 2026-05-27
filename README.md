# wsedit

Middle tier for Soulmask saved-game editing. Sits between
[wscodec](https://github.com/auroris/SoulmaskCodec) (byte-level `actor_data`
codec) and the browser UI ([SoulmaskDB](https://github.com/auroris/SoulmaskDB)):

```
  world.db (SQLite)
     └── actor_table rows
            └── actor_data BLOB ── wscodec ── property tree (FGuid, FName, ...)
                                                      │
                                                      ▼
                                                   wsedit
                                       (relations, compounds, ownership,
                                        identity, stash, transfer)
                                                      │
                                                      ▼
                                                   SoulmaskDB UI
```

wsedit is responsible for everything above the raw codec and below the UI:

- **Row classification** — kind (player, container, npc, building, ...),
  short label, summary key. UI handles localization.
- **GUID-based relationships** — walks the decoded property tree, indexes
  every `FGuid` (own ID + references), exposes the graph for relation
  queries. Replaces SoulmaskDB's old heuristic relation logic.
- **Compound objects** — a building isn't a single row; it's a root row plus
  its BG-actor inventory, its anchored region, etc. wsedit defines a
  compound as the transitive GUID closure under a declarative edge policy,
  so the rest of the app can treat (e.g.) a chest and its inventory as one
  thing.
- **Ownership** — player → clan → owned compounds, walked via `FGuid` chains.
- **Cross-save identity** — players are keyed by Steam64; the same player
  across two saves merges identity-aware.
- **Stash and transfer** — extract a compound to a portable envelope; paste
  into a destination world, rewriting GUIDs and coordinates as needed.

## Status

Early. Scaffold only — the modules above are designed, not yet implemented.

## Install

```sh
npm install wsedit
```

Requires Node 20+ for the test/script tooling. The published library itself
is a browser ES module; the `dist/` bundles ship ESM, CJS, and an IIFE
global (`window.wsedit`) for `<script>`-tag consumers.

## Usage

```js
// (to be filled in as modules land)
import { /* ... */ } from 'wsedit';
```

## Scripts and tests

```sh
npm run build           # esbuild bundles + tsc types + typedoc docs
npm test                # run every test:* script in package.json
```

The test scripts take a `world.db` path as the first argument, defaulting to
`../world.db` relative to the repo root (so a sibling save folder works
without a flag) — same convention as wscodec.

## Runtime dependencies

- [`wscodec`](https://www.npmjs.com/package/wscodec) — the only runtime dep.

`better-sqlite3` and `lz4-wasm-nodejs` are dev-only: they're used by Node
test/script code that exercises wsedit against real `world.db` files. The
browser runtime gets SQLite from the host page's wasm sqlite3 build, and
LZ4 is caller-supplied — wsedit itself stays LZ4-agnostic, same pattern as
wscodec.

## License

MIT. See [LICENSE](LICENSE).
