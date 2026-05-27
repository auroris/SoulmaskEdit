/**
 * Test: classifier + transform + translate-ident surface.
 *
 * Primary `kind` aligns with wscodec's tables (npc, building) plus wsedit's
 * internal-only kinds (system, player, inventory, region, other). `subKind`
 * carries the UI refinement. The test exercises every branch:
 *
 *   - canonical-name + canonical-script (system, player) with key summary
 *   - internal-component rules (inventory, system, region) — caught BEFORE
 *     the wscodec lookup
 *   - wscodec.npcs hit → kind 'npc' + subKind from substring (animal,
 *     humanoid, vehicle, or null)
 *   - wscodec.buildings hit → kind 'building' + subKind (workstation,
 *     furniture, container, vegetation, animal_house, or null)
 *   - 'other' for classes not in any table
 *
 * Real wscodec class names are used wherever a wscodec table hit is
 * required; synthetic scripts are used for the substring-only paths.
 *
 * Self-contained — does not need a world.db. Run via `npm test` or
 * directly: `node test/test-classify.mjs`.
 */

import {
  classify, shortClassName,
  isPlayerRow, isSystemRow,
  isInventoryStorageRow, isInventoryOwnerRow,
  aggregateScripts,
  SCRIPT, NAME, KINDS, SUBKINDS_BY_KIND, RULES,
} from '../src/classify.mjs';
import {
  parseTransform, bearingFromTransform, distanceMeters, COMPASS_8,
} from '../src/transform.mjs';
import { translateIdent, decomposeIdent } from '../src/translate-ident.mjs';

let fails = 0;
function expect(cond, msg) {
  if (cond) return;
  fails++;
  console.error(`  FAIL: ${msg}`);
}
function eq(a, b, msg) { expect(deepEq(a, b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function deepEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEq(a[k], b[k]));
  }
  return false;
}

// ---------- shortClassName ---------------------------------------------

console.log('shortClassName');
eq(shortClassName('/Game/Blueprints/DongWu/BP_DongWu_Yu.BP_DongWu_Yu_C'),
   'BP_DongWu_Yu', 'extracts class token from full path');
eq(shortClassName('/Script/WS.HPlayerState'), 'HPlayerState', 'last path segment when no _C suffix');
eq(shortClassName(''),   '', 'empty input → empty');
eq(shortClassName(null), '', 'null input → empty');

// ---------- classify: KIND_RULES (canonical rows) ----------------------

console.log('classify: canonical rows');
{
  const r = classify({ actor_name: NAME.GAME_SETTINGS });
  eq(r.kind, 'system', 'GAME_SETTINGS → system');
  eq(r.subKind, null,  'system has no subKind');
  eq(r.label,   NAME.GAME_SETTINGS, 'label = actor_name');
  eq(r.summary, { type: 'key', key: 'ui.classify.gameSettings' }, 'summary is i18n key');
}
{
  const r = classify({ actor_name: NAME.GAMEMODE });
  eq(r.kind, 'system', 'GAMEMODE → system');
}
{
  const r = classify({ actor_script: SCRIPT.PLAYER_STATE, actor_name: '76561198000000001' });
  eq(r.kind, 'player', 'PLAYER_STATE → player');
  eq(r.subKind, null, 'player has no subKind');
  eq(r.label, '76561198000000001', 'label = Steam64 actor_name');
  eq(r.summary, { type: 'key', key: 'ui.classify.playerSave' }, 'summary is i18n key');
}

// ---------- classify: KIND_RULES (internal-component patterns) ---------

console.log('classify: internal components');
{
  // BindBGCompActor — player inventory storage component. Not in wscodec
  // tables (it's a Soulmask internal). Caught by KIND_RULES.
  const r = classify({ actor_script: '/Game/Blueprints/Player/BP_BindBGCompActor.BP_BindBGCompActor_C' });
  eq(r.kind, 'inventory', 'BindBGCompActor → inventory');
  eq(r.subKind, null, 'inventory has no subKind');
}
{
  // BindBGCompDongWu — animal inventory storage. Also caught here, not in
  // the dongwu substring rule (which is now a npc-subKind rule).
  const r = classify({ actor_script: '/Game/Blueprints/DongWu/BP_BindBGCompDongWu.BP_BindBGCompDongWu_C' });
  eq(r.kind, 'inventory', 'BindBGCompDongWu → inventory (not animal)');
}
{
  // BGActor_* — workbench inventory storage.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/RongQi/BP_BGActor_GongZuoTai.BP_BGActor_GongZuoTai_C' });
  eq(r.kind, 'inventory', 'BGActor_* → inventory (not container)');
}
{
  const r = classify({ actor_script: '/Game/Blueprints/GongHui/BP_WenMingGuanLiQi.BP_WenMingGuanLiQi_C' });
  eq(r.kind, 'system', '*GuanLiQi → system');
}
{
  const r = classify({ actor_script: '/Game/Blueprints/Region/BP_JianZhuPianQu.BP_JianZhuPianQu_C' });
  eq(r.kind, 'region', 'JianZhuPianQu → region');
}

// ---------- classify: wscodec.npcs → kind 'npc' + subKind ---------------

console.log('classify: wscodec.npcs (npc kind)');
{
  // BP_DongWu_YeZhu is a boar — in wscodec.npcs. dongwu substring → animal subKind.
  const r = classify({ actor_script: '/Game/Blueprints/DongWu/BP_DongWu_YeZhu.BP_DongWu_YeZhu_C' });
  eq(r.kind,    'npc',    'animal class → npc kind (Soulmask view)');
  eq(r.subKind, 'animal', 'dongwu substring → animal subKind');
}
{
  // BP_SuiJi_BuLuo is a Barbarian — in wscodec.npcs. suiji → humanoid subKind.
  const r = classify({ actor_script: '/Game/Blueprints/SuiJi/BuLuo/BP_SuiJi_BuLuo.BP_SuiJi_BuLuo_C' });
  eq(r.kind,    'npc',      'BP_SuiJi_BuLuo → npc');
  eq(r.subKind, 'humanoid', 'suiji substring → humanoid subKind');
}
{
  // BP_Ship_03 is a small wooden boat — in wscodec.npcs (Soulmask treats ships
  // as NPCs). bp_ship → vehicle subKind.
  const r = classify({ actor_script: '/Game/Blueprints/Ship/BP_Ship_03.BP_Ship_03_C' });
  eq(r.kind,    'npc',     'BP_Ship_03 → npc (Soulmask view)');
  eq(r.subKind, 'vehicle', 'bp_ship substring → vehicle subKind');
}

// ---------- classify: wscodec.buildings → kind 'building' + subKind -----

console.log('classify: wscodec.buildings (building kind)');
{
  // BP_GongZuoTai_DaMuXiang (large wooden box workbench) — in wscodec.buildings.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/GongZuoTai/BP_GongZuoTai_DaMuXiang.BP_GongZuoTai_DaMuXiang_C' });
  eq(r.kind,    'building',    'workstation class → building');
  eq(r.subKind, 'workstation', 'jianzhu/gongzuotai → workstation subKind');
}
{
  // BP_JiaJu_ZuoYi_YiZi (chair) — in wscodec.buildings.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/JiaJu/BP_JiaJu_ZuoYi_YiZi.BP_JiaJu_ZuoYi_YiZi_C' });
  eq(r.kind,    'building',  'chair → building');
  eq(r.subKind, 'furniture', 'jianzhu/jiaju → furniture subKind');
}
{
  // BP_RongQi_Box_Base — in wscodec.buildings.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/RongQi/BP_RongQi_Box_Base.BP_RongQi_Box_Base_C' });
  eq(r.kind,    'building',  'chest base → building');
  eq(r.subKind, 'container', 'jianzhu/rongqi → container subKind');
}
{
  // BP_ZhongZhi_GengDi_1 (farmland) — in wscodec.buildings.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/ZhongZhi/BP_ZhongZhi_GengDi_1.BP_ZhongZhi_GengDi_1_C' });
  eq(r.kind,    'building',   'farmland → building');
  eq(r.subKind, 'vegetation', 'jianzhu/zhongzhi → vegetation subKind');
}
{
  // BP_AnimalHouse_Chicken (chicken coop) — in wscodec.buildings.
  const r = classify({ actor_script: '/Game/Blueprints/AnimalHouse/BP_AnimalHouse_Chicken.BP_AnimalHouse_Chicken_C' });
  eq(r.kind,    'building',     'chicken coop → building');
  eq(r.subKind, 'animal_house', 'animalhouse → animal_house subKind');
}
{
  // BP_JianZhuJingJiChang_ZL01 (arena variant) — in wscodec.buildings, no
  // subKind rule matches → subKind null.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/BP_JianZhuJingJiChang_ZL01.BP_JianZhuJingJiChang_ZL01_C' });
  eq(r.kind,    'building', 'arena variant → building');
  eq(r.subKind, null,       'no subKind rule matched → null');
}

// ---------- classify: rule priority -------------------------------------

console.log('classify: rule priority');
{
  // Internal-component rules run before wscodec — BindBGCompDongWu has the
  // dongwu substring but must still classify as inventory.
  const r = classify({ actor_script: '/Game/Blueprints/DongWu/BP_BindBGCompDongWu.BP_BindBGCompDongWu_C' });
  eq(r.kind, 'inventory', 'KIND_RULES beat wscodec.npcs for BindBGCompDongWu');
}
{
  // GuanLiQi run before wscodec; a class with both jianzhu and guanliqi
  // stays system.
  const r = classify({ actor_script: '/Game/Blueprints/JianZhu/BP_JianZhuGuanLiQi.BP_JianZhuGuanLiQi_C' });
  eq(r.kind, 'system', 'guanliqi beats wscodec.buildings');
}

// ---------- classify: catch-all 'other' --------------------------------

console.log('classify: catch-all');
{
  const r = classify({ actor_script: '/Game/Blueprints/Foo/BP_TotallyMadeUpClass.BP_TotallyMadeUpClass_C' });
  eq(r.kind,    'other', 'unknown class → other');
  eq(r.subKind, null,    'other has no subKind');
  expect(r.summary.type === 'generic', 'catch-all uses generic summary');
  eq(r.summary.ident, 'BP_TotallyMadeUpClass', 'ident = shortClassName');
}
{
  const r = classify({});
  eq(r.kind, 'other', 'empty row → other');
}

// ---------- classify: generic summary pos/bearing ----------------------

console.log('classify: generic summary pos/bearing');
{
  const r = classify({
    actor_script: '/Game/Blueprints/DongWu/BP_DongWu_YeZhu.BP_DongWu_YeZhu_C',
    actor_transf: '100,200,300|0,90,0|1,1,1',  // yaw=90 → 'N'
  });
  eq(r.summary.pos, [100, 200, 300], 'pos parsed');
  eq(r.summary.bearing, 'N', 'yaw=90 → N');
}
{
  const r = classify({ actor_script: '/Game/Blueprints/Foo/BP_X_C', actor_transf: 'malformed' });
  eq(r.summary.pos, null, 'malformed transf → pos null');
}

// ---------- predicates --------------------------------------------------

console.log('predicates');
expect(isPlayerRow({ actor_script: SCRIPT.PLAYER_STATE }), 'isPlayerRow: PLAYER_STATE');
expect(!isPlayerRow({ actor_script: '/Other' }),           'isPlayerRow: other');

expect(isSystemRow({ actor_name: NAME.GAME_SETTINGS }), 'isSystemRow: GAME_SETTINGS');
expect(!isSystemRow({ actor_name: 'Other' }),           'isSystemRow: other');

expect(isInventoryStorageRow({ actor_script: 'BP_BindBGCompActor_C' }),  'storage: BindBGCompActor');
expect(isInventoryStorageRow({ actor_script: 'BP_BindBGCompDongWu_C' }), 'storage: BindBGCompDongWu');
expect(isInventoryStorageRow({ actor_script: 'BP_BGActor_X_C' }),         'storage: BGActor');
expect(!isInventoryStorageRow({ actor_script: 'BP_DongWu_Yu_C' }),        'storage: not animal class');

// isInventoryOwnerRow now operates on the Soulmask-aligned taxonomy.
expect(isInventoryOwnerRow({ kind: 'building' }), 'owner: building');
expect(isInventoryOwnerRow({ kind: 'npc' }),      'owner: npc');
expect(isInventoryOwnerRow({ kind: 'player' }),   'owner: player');
expect(!isInventoryOwnerRow({ kind: 'inventory' }), 'owner: inventory is not owner');
expect(!isInventoryOwnerRow({ kind: 'system' }),    'owner: system');
expect(!isInventoryOwnerRow({ kind: 'region' }),    'owner: region');

// ---------- aggregateScripts -------------------------------------------

console.log('aggregateScripts');
{
  const rows = [
    { actor_script: 'BP_A', _kind: 'building', _subKind: 'workstation', _label: 'A' },
    { actor_script: 'BP_A', _kind: 'building', _subKind: 'workstation', _label: 'A' },
    { actor_script: 'BP_B', _kind: 'npc',      _subKind: 'animal',      _label: 'B' },
  ];
  const out = aggregateScripts(rows).sort((a, b) => a.script.localeCompare(b.script));
  eq(out, [
    { script: 'BP_A', count: 2, kind: 'building', subKind: 'workstation', sampleLabel: 'A' },
    { script: 'BP_B', count: 1, kind: 'npc',      subKind: 'animal',      sampleLabel: 'B' },
  ], 'aggregates by script preserving kind+subKind');
}

// ---------- transform helpers ------------------------------------------

console.log('parseTransform');
{
  const tx = parseTransform('1.5,2.5,3.5|10,20,30|1,1,1');
  eq(tx, { pos: [1.5, 2.5, 3.5], rot: [10, 20, 30], scale: [1, 1, 1] }, 'parses valid string');
}
eq(parseTransform(''),          null, 'empty → null');
eq(parseTransform(null),        null, 'null → null');
eq(parseTransform('1,2,3'),     null, 'missing segments → null');
eq(parseTransform('1,2|3,4|5'), null, 'wrong arity → null');
eq(parseTransform('a,b,c|0,0,0|1,1,1'), null, 'non-numeric → null');

console.log('bearingFromTransform');
{
  // COMPASS_8 = ['E','NE','N','NW','W','SW','S','SE']; each octant is 45°.
  const cases = [
    [0, 'E'], [45, 'NE'], [90, 'N'], [135, 'NW'],
    [180, 'W'], [225, 'SW'], [270, 'S'], [315, 'SE'],
    [360, 'E'], [-45, 'SE'], [720, 'E'],
  ];
  for (const [yaw, want] of cases) {
    eq(bearingFromTransform({ rot: [0, yaw, 0] }), want, `yaw=${yaw} → ${want}`);
  }
  eq(bearingFromTransform(null),                  null, 'null → null');
  eq(bearingFromTransform({ rot: [0, NaN, 0] }),  null, 'NaN yaw → null');
  eq(bearingFromTransform({ rot: [0, 0] }),       null, 'short rot → null');
}

console.log('distanceMeters');
{
  const d = distanceMeters({ pos: [300, 400, 0] }, [0, 0, 0]);
  eq(d, 5, '300/400 cm vs origin = 5m');
}
eq(distanceMeters(null, [0, 0, 0]),        null, 'null tx → null');
eq(distanceMeters({ pos: [0, 0, 0] }, []), null, 'bad anchor → null');

// ---------- translateIdent / decomposeIdent ----------------------------

console.log('translateIdent');
{
  const gloss = { DongWu: 'Animal', Yu: 'Fish', ZhiBei: 'Vegetation', GuanLiQi: 'Manager' };
  const lookup = (t) => Object.prototype.hasOwnProperty.call(gloss, t) ? gloss[t] : null;

  eq(translateIdent('BP_DongWu_Yu_C', lookup), 'Animal Fish',
     'strips BP_/_C, joins decomposed parts');
  eq(translateIdent('ZhiBeiGuanLiQi', lookup), 'Vegetation Manager',
     'PascalCase walking finds longest gloss prefix');
  eq(translateIdent('HUnknown_Thing', lookup), 'Unknown Thing',
     'strips H prefix; unknown tokens pass through');
  eq(translateIdent('BP_TotallyUnknown_C', lookup), 'TotallyUnknown',
     'unknown class passes through');
  eq(translateIdent('', lookup),  '', 'empty → empty');
  eq(translateIdent(null, lookup), '', 'null → empty');
}
eq(decomposeIdent('Foo', () => null), 'Foo', 'raw passthrough when no lookup match');

// ---------- KINDS / SUBKINDS_BY_KIND sanity ----------------------------

console.log('KINDS / SUBKINDS_BY_KIND');
expect(KINDS.includes('npc') && KINDS.includes('building') && KINDS.includes('other'),
  'KINDS includes Soulmask-aligned + catch-all');
expect(!KINDS.includes('animal'),    'KINDS no longer includes animal (now a subKind)');
expect(!KINDS.includes('container'), 'KINDS no longer includes container (now a subKind)');
expect(Object.isFrozen(KINDS),            'KINDS frozen');
expect(Object.isFrozen(SUBKINDS_BY_KIND), 'SUBKINDS_BY_KIND frozen');
expect(SUBKINDS_BY_KIND.npc.includes('animal'),         'npc subKinds include animal');
expect(SUBKINDS_BY_KIND.building.includes('container'), 'building subKinds include container');

expect(Object.isFrozen(RULES),         'RULES frozen');
expect(Array.isArray(RULES.kind),      'RULES.kind is the primary-kind table');
expect(typeof RULES.subKind === 'object', 'RULES.subKind is keyed by kind');

// ---------- summary ----------------------------------------------------

if (fails > 0) {
  console.error(`\n${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nclassify: all assertions passed');
