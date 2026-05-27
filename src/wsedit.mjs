/**
 * wsedit: middle tier for Soulmask saved-game editing.
 *
 * Sits between wscodec (byte-level actor_data codec) and the browser UI:
 *
 *   world.db (SQLite)
 *      └── actor_table rows
 *             └── actor_data BLOB ── wscodec ── property tree (FGuid, FName, ...)
 *
 *   wsedit reads rows, walks the decoded property trees, indexes the
 *   FGuid graph, and exposes higher-level objects the UI can act on:
 *
 *     - classify(row)        → kind, label, summary key
 *     - guidIndex(db)        → row ↔ FGuid graph, memoized
 *     - compound(rootRow)    → transitive closure of GUID references, with
 *                              edge-policy (inventory walk-through, etc.)
 *     - ownership(playerRow) → player → clan → owned compounds
 *     - identity(steam64)    → cross-save player identity
 *     - stash / transfer     → extract a compound to a portable envelope,
 *                              paste into a destination world, rewriting
 *                              GUIDs and coordinates as needed
 *
 * Browser library, zero runtime LZ4 dep (callers inject — same pattern as
 * wscodec). Node devDependencies are for the test/script side only.
 *
 * Public surface re-exports go here as modules land. See individual module
 * headers for the design rationale of each piece.
 */

export const VERSION = '0.1.0';

// Row classification — kind, label, structured summary. UI handles
// localization; wsedit returns i18n keys or raw class-name tokens.
export {
  classify,
  shortClassName,
  isPlayerRow, isSystemRow,
  isInventoryStorageRow, isInventoryOwnerRow,
  aggregateScripts,
  SCRIPT, NAME, KINDS, SUBKINDS_BY_KIND, RULES,
} from './classify.mjs';

// Transform-string parsing (actor_transf column). Pure helpers.
export {
  parseTransform,
  bearingFromTransform,
  distanceMeters,
  COMPASS_8,
} from './transform.mjs';

// Romanized-Mandarin identifier decomposer. Algorithm only — caller
// supplies the per-locale gloss lookup function.
export {
  translateIdent,
  decomposeIdent,
} from './translate-ident.mjs';

// Cross-row reference collectors — pull GUIDs and actor-instance
// ObjectRefs out of a decoded UnrealBlob.
export {
  collectRefs,
  collectGuids,
  collectObjRefs,
} from './refs.mjs';

// Stateful cross-row reference index. Pairs every row's identity GUID
// with its incoming references; resolves ObjectRef targets by actor_name.
export {
  Relations,
  IDENTITY_PATH_BY_KIND,
  DEFAULT_IDENTITY_PATH,
  NESTED_IDENTITY_PATTERNS,
} from './relations.mjs';
