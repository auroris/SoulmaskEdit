/**
 * Row classifier — maps a raw actor_table row to a structured result
 * describing what kind of thing it is.
 *
 * Primary `kind` aligns with Soulmask's own categorization (wscodec's
 * translation tables): every row whose class lives in `wscodec.npcs` is
 * `'npc'`; every row in `wscodec.buildings` is `'building'`. Soulmask's
 * "building" is broad — workstations, walls, floors, chests, furniture,
 * farmland, and chicken coops are all buildings. "NPC" includes humanoid
 * NPCs, animals, and (oddly) ships.
 *
 * On top of that, `subKind` carries our UI-driven refinements (animal vs.
 * humanoid vs. vehicle for npc; workstation vs. furniture vs. container
 * vs. vegetation vs. animal_house for building). subKind is derived from
 * substring patterns on the script path AFTER the primary kind is known.
 *
 * A few kinds are wsedit-defined because Soulmask doesn't surface them in
 * its tables: internal Unreal components (`'inventory'` — BindBGCompActor /
 * BindBGCompDongWu / BGActor), system managers (`'system'` — *GuanLiQi),
 * world chunks (`'region'` — JianZhuPianQu). These are caught by
 * KIND_RULES BEFORE the wscodec lookup.
 *
 * Classification order:
 *   1. KIND_RULES (canonical named/script rows + internal-component
 *      patterns). First-match wins.
 *   2. wscodec.npcs lookup → kind 'npc'.
 *   3. wscodec.buildings lookup → kind 'building'.
 *   4. Else → kind 'other'.
 * After kind is decided in steps 2/3, SUBKIND_RULES[kind] is walked to
 * derive subKind. Other kinds don't have subKinds (subKind = null).
 *
 * Result shape, returned by classify(row):
 *   kind:    one of KINDS (primary, Soulmask-aligned)
 *   subKind: one of SUBKINDS_BY_KIND[kind] | null
 *   label:   actor_name (canonical rows) or shortClassName(script) (others)
 *   summary:
 *     { type: 'key', key }                          — canonical row
 *     { type: 'generic', ident, pos, bearing }      — generic row
 *
 * SCRIPT and NAME export canonical strings so callers don't have to
 * restate them.
 *
 * Note: SoulmaskDB's old heuristic findRelations is deliberately not
 * ported. Row relationships are GUID-keyed and will be served by a future
 * relations module that walks the wscodec-decoded property tree.
 */

import { parseTransform, bearingFromTransform } from './transform.mjs';
import { npc as wscodecNpc, building as wscodecBuilding } from 'wscodec/translations';

/**
 * Canonical script paths. Compare `actor_script === SCRIPT.X` to detect a
 * specific row kind structurally rather than guessing from substrings.
 */
export const SCRIPT = Object.freeze({
  PLAYER_STATE: '/Script/WS.HPlayerState',
});

/**
 * Reserved actor_name strings used by the game for global config rows.
 */
export const NAME = Object.freeze({
  GAME_SETTINGS: 'GAME_SETTINGS',
  GAMEMODE:      'GAMEMODE',
});

/**
 * Primary kinds (Soulmask-aligned). The set classify() may return for
 * `kind`. UI pills, filter dropdowns, and rule extensions all key off
 * these strings.
 */
export const KINDS = Object.freeze([
  'system', 'player', 'inventory', 'region',  // wsedit-defined (internal)
  'npc', 'building',                          // wscodec-aligned
  'other',                                    // catch-all
]);

/**
 * UI-driven subKind refinements organized by primary kind. classify() may
 * return one of these for `subKind`, or null when no rule matched (or
 * when the primary kind doesn't define subKinds).
 */
export const SUBKINDS_BY_KIND = Object.freeze({
  npc:      Object.freeze(['animal', 'humanoid', 'vehicle']),
  building: Object.freeze(['workstation', 'furniture', 'container', 'vegetation', 'animal_house']),
});

/**
 * Primary-kind rules. First-match-wins. Run BEFORE the wscodec lookup so
 * internal/component rows (which Soulmask doesn't expose in its tables)
 * are caught.
 *
 * Rule shape:
 *   { name: '...' }            — exact actor_name match
 *   { script: '...' }          — exact actor_script match
 *   { scriptContains: ... }    — case-insensitive substring on script
 *   kind:    one of KINDS
 *   summary: optional i18n key. If present, row is treated as "canonical":
 *            result.summary is { type: 'key', key } and pos/bearing are
 *            not computed.
 */
const KIND_RULES = Object.freeze([
  // Canonical named rows.
  { name: NAME.GAME_SETTINGS, kind: 'system', summary: 'ui.classify.gameSettings' },
  { name: NAME.GAMEMODE,      kind: 'system', summary: 'ui.classify.gameMode' },

  // Canonical script paths.
  { script: SCRIPT.PLAYER_STATE, kind: 'player', summary: 'ui.classify.playerSave' },

  // Internal Unreal-component rows (player/animal/workbench inventory
  // storage). 'bindbgcomp' catches every observed variant: BindBGCompActor
  // (player), BindBGCompDongWu (animal), BindBGCompZhuangBeiDongWu (animal
  // equipment), and any future BindBGComp* additions. 'bgactor' covers
  // workbench storage rows. None of these live in wscodec's tables.
  { scriptContains: ['bindbgcomp', 'bgactor'], kind: 'inventory' },

  // Internal Soulmask system managers (*GuanLiQi = manager/registry).
  { scriptContains: 'guanliqi', kind: 'system' },

  // Internal world chunks.
  { scriptContains: 'jianzhupianqu', kind: 'region' },
]);

/**
 * SubKind rules, applied once the primary kind is known. For each kind,
 * substring rules are tried in order; first match wins. No match → null.
 */
const SUBKIND_RULES = Object.freeze({
  npc: Object.freeze([
    { scriptContains: ['monster', 'dongwu'],                                              subKind: 'animal' },
    { scriptContains: ['/ship/', 'bp_ship', 'bp_boat', 'bp_deck', 'gangway'],             subKind: 'vehicle' },
    { scriptContains: ['/npc/', 'tribe', 'savage', 'sandbandits', 'desertwolf', 'exiles',
                       'suiji', 'shenmi'],                                                subKind: 'humanoid' },
  ]),
  building: Object.freeze([
    { scriptContains: ['jianzhu/gongzuotai', 'jianzhu/fengche', 'jianzhu/lighting',
                       'jianzhu/chuansongmen', 'conveyor', 'gongzuotai'],                 subKind: 'workstation' },
    { scriptContains: ['jianzhu/jiaju', 'jiaju'],                                         subKind: 'furniture' },
    { scriptContains: ['jianzhu/rongqi', 'jianzhu/baoguoactor', 'hbaoxiang',
                       'rongqi', 'box_', 'storage_savebox'],                              subKind: 'container' },
    { scriptContains: ['jianzhu/zhongzhi', 'zhongzhi'],                                   subKind: 'vegetation' },
    { scriptContains: 'animalhouse',                                                      subKind: 'animal_house' },
  ]),
});

/**
 * Read-only access to the rule tables — UI introspection and tests.
 */
export const RULES = Object.freeze({ kind: KIND_RULES, subKind: SUBKIND_RULES });

/**
 * ".../Foo.BP_DongWu_Yu_C" → "BP_DongWu_Yu". Falls back to the last
 * path-segment if there's no trailing `_C` suffix at a path boundary.
 *
 * @param {string | null | undefined} scriptPath
 * @returns {string}
 */
export function shortClassName(scriptPath) {
  if (!scriptPath) return '';
  const m = scriptPath.match(/[./]([^./]+)_C$/);
  if (m) return m[1];
  const parts = scriptPath.split(/[./]/);
  return parts[parts.length - 1] || scriptPath;
}

/**
 * Classify an actor_table row.
 *
 * @param {{ actor_name?: string, actor_script?: string, actor_transf?: string }} row
 * @returns {{
 *   kind: string,
 *   subKind: string | null,
 *   label: string,
 *   summary:
 *     | { type: 'key', key: string }
 *     | { type: 'generic', ident: string, pos: [number, number, number] | null, bearing: string | null }
 * }}
 */
export function classify(row) {
  const name   = (row && row.actor_name)   || '';
  const script = (row && row.actor_script) || '';
  const scriptLower = script.toLowerCase();
  const transf = row && row.actor_transf;

  // Phase 1: primary-kind rules. Includes canonical rows and internal
  // (non-Soulmask-table) patterns.
  for (const rule of KIND_RULES) {
    if (!ruleMatches(rule, row || {}, scriptLower)) continue;
    if (rule.summary) {
      return {
        kind: rule.kind,
        subKind: null,
        label: name,
        summary: { type: 'key', key: rule.summary },
      };
    }
    return buildGeneric(rule.kind, null, script, transf);
  }

  // Phase 2: wscodec-table lookup determines primary kind for everything
  // Soulmask categorizes as a user-facing object.
  if (script) {
    if (wscodecNpc(script))      return buildGeneric('npc',      deriveSubKind('npc',      scriptLower), script, transf);
    if (wscodecBuilding(script)) return buildGeneric('building', deriveSubKind('building', scriptLower), script, transf);
  }

  return buildGeneric('other', null, script, transf);
}

function ruleMatches(rule, row, scriptLower) {
  if (rule.name   && rule.name   === row.actor_name)   return true;
  if (rule.script && rule.script === row.actor_script) return true;
  if (rule.scriptContains) {
    const pats = Array.isArray(rule.scriptContains) ? rule.scriptContains : [rule.scriptContains];
    return pats.some(p => scriptLower.includes(p));
  }
  return false;
}

function deriveSubKind(kind, scriptLower) {
  const rules = SUBKIND_RULES[kind];
  if (!rules) return null;
  for (const rule of rules) {
    const pats = Array.isArray(rule.scriptContains) ? rule.scriptContains : [rule.scriptContains];
    if (pats.some(p => scriptLower.includes(p))) return rule.subKind;
  }
  return null;
}

function buildGeneric(kind, subKind, script, transf) {
  const ident = shortClassName(script);
  const tx = parseTransform(transf);
  const pos = tx ? /** @type {[number, number, number]} */ ([tx.pos[0], tx.pos[1], tx.pos[2]]) : null;
  const bearing = tx ? bearingFromTransform(tx) : null;
  return { kind, subKind, label: ident, summary: { type: 'generic', ident, pos, bearing } };
}

// ---- Predicates -------------------------------------------------------

/**
 * @param {{ actor_script?: string }} row
 * @returns {boolean}
 */
export function isPlayerRow(row) {
  return !!row && row.actor_script === SCRIPT.PLAYER_STATE;
}

/**
 * @param {{ actor_name?: string }} row
 * @returns {boolean}
 */
export function isSystemRow(row) {
  const n = row && row.actor_name;
  return n === NAME.GAME_SETTINGS || n === NAME.GAMEMODE;
}

/**
 * Structural role predicate — does this row hold inventory bytes?
 * (BG-actor / BindBGCompActor / BindBGCompDongWu shapes.)
 *
 * @param {{ actor_script?: string }} row
 * @returns {boolean}
 */
export function isInventoryStorageRow(row) {
  const s = (row && row.actor_script) || '';
  const sl = s.toLowerCase();
  return sl.includes('bgactor') || sl.includes('bindbgcompactor') || sl.includes('bindbgcompdongwu');
}

/**
 * Structural role predicate — can this row OWN inventory? True for
 * top-level world entities (anything in wscodec's npcs or buildings, plus
 * the player). Determined from the row's classified kind.
 *
 * @param {{ kind?: string } | { _kind?: string }} rowOrResult
 * @returns {boolean}
 */
export function isInventoryOwnerRow(rowOrResult) {
  const k = rowOrResult && (rowOrResult.kind || rowOrResult._kind);
  return k === 'building' || k === 'player' || k === 'npc';
}

// ---- Aggregation utility ----------------------------------------------

/**
 * Group classified rows by actor_script. Returns one record per distinct
 * script with { script, count, kind, subKind, sampleLabel }. Since classify
 * is deterministic per script, kind/subKind are uniform within a script
 * and the first sample is representative.
 *
 * Expects rows with `_kind`, `_subKind`, and `_label` set (the
 * in-place annotation pattern), so this helper can be applied
 * post-classification without recomputing.
 *
 * @param {Array<{ actor_script?: string, _kind?: string, _subKind?: string|null, _label?: string }>} rows
 * @returns {Array<{ script: string, count: number, kind: string, subKind: string|null, sampleLabel: string }>}
 */
export function aggregateScripts(rows) {
  const stats = new Map();
  for (const r of rows) {
    const script = r.actor_script == null ? '' : r.actor_script;
    let s = stats.get(script);
    if (!s) {
      s = { script, count: 0, kind: r._kind || 'other', subKind: r._subKind ?? null, sampleLabel: r._label || '' };
      stats.set(script, s);
    }
    s.count++;
  }
  return [...stats.values()];
}
