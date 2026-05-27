[**wsedit**](../README.md)

***

[wsedit](../README.md) / VERSION

# Variable: VERSION

> `const` **VERSION**: `"0.1.0"` = `'0.1.0'`

Defined in: wsedit.mjs:30

wsedit: middle tier for Soulmask saved-game editing.

Sits between wscodec (byte-level actor_data codec) and the browser UI:

  world.db (SQLite)
     └── actor_table rows
            └── actor_data BLOB ── wscodec ── property tree (FGuid, FName, ...)

  wsedit reads rows, walks the decoded property trees, indexes the
  FGuid graph, and exposes higher-level objects the UI can act on:

    - classify(row)        → kind, label, summary key
    - guidIndex(db)        → row ↔ FGuid graph, memoized
    - compound(rootRow)    → transitive closure of GUID references, with
                             edge-policy (inventory walk-through, etc.)
    - ownership(playerRow) → player → clan → owned compounds
    - identity(steam64)    → cross-save player identity
    - stash / transfer     → extract a compound to a portable envelope,
                             paste into a destination world, rewriting
                             GUIDs and coordinates as needed

Browser library, zero runtime LZ4 dep (callers inject — same pattern as
wscodec). Node devDependencies are for the test/script side only.

Public surface re-exports go here as modules land. See individual module
headers for the design rationale of each piece.
