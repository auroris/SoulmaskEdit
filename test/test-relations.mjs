/**
 * Test: collectRefs + Relations index.
 *
 * Synthetic UnrealBlob fixtures cover:
 *   - identity vs outbound reference (player ZhuRenGuid vs npc ZhuRenGuid)
 *   - SelfUid as default identity path
 *   - zero-GUID filtering
 *   - GUIDs inside StructProperty<Guid>, arrays of GUIDs, map values
 *   - ObjectRef.path → outboundObjRefsFrom + actorNameLookup resolution
 *   - nested-identity (MapHoldJianZhuList) excluded from outbound,
 *     registered in rowBySelfUid
 *   - add / drop / refresh lifecycle
 *
 * Self-contained — no world.db needed. Run via `npm test` or directly.
 */

import {
  UnrealBlob, PropertyStream, PropertyTag, FName, FGuid,
  StructProperty, StructValue,
  ArrayProperty, MapProperty,
  ObjectProperty, ObjectRef,
} from 'wscodec';

import {
  collectRefs, collectGuids, collectObjRefs,
  Relations, IDENTITY_PATH_BY_KIND, DEFAULT_IDENTITY_PATH,
} from '../src/wsedit.mjs';

let fails = 0;
function expect(cond, msg) { if (!cond) { fails++; console.error(`  FAIL: ${msg}`); } }
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

// ---- helpers ----------------------------------------------------------

const G_ZERO = '00000000-0000-0000-0000-000000000000';
const G_A    = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
const G_B    = 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB';
const G_C    = 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC';
const G_D    = 'DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD';

// Build a top-level StructProperty<Guid> with the given property name +
// canonical GUID string.
function guidProp(name, guidStr) {
  const tag = new PropertyTag({
    name:       FName.from(name),
    type:       FName.from('StructProperty'),
    structName: FName.from('Guid'),
    structGuid: FGuid.zero(),
  });
  const value = new StructValue('Guid', {
    form: 'binary',
    binaryValue: new FGuid(guidStr),
  });
  return new StructProperty({ tag, value });
}

// Build an ArrayProperty whose elements are StructValue<Guid> with the
// given GUID strings.
function guidArrayProp(name, guidStrs) {
  const tag = new PropertyTag({
    name:      FName.from(name),
    type:      FName.from('ArrayProperty'),
    innerType: FName.from('StructProperty'),
  });
  const elements = guidStrs.map(g => new StructValue('Guid', {
    form: 'binary',
    binaryValue: new FGuid(g),
  }));
  return new ArrayProperty({ tag, elements });
}

// Build an ObjectProperty whose ObjectRef points at the given actor path.
function objRefProp(name, targetPath) {
  const tag = new PropertyTag({
    name: FName.from(name),
    type: FName.from('ObjectProperty'),
  });
  const value = new ObjectRef({ kind: 0x03, path: targetPath });
  return new ObjectProperty({ tag, value });
}

// Build a MapProperty<int32, StructProperty<propStream>> where each value
// is a property stream containing a `JianZhuIndicator` sub-struct with a
// `JianZhuUid` Guid. Mirrors the MapHoldJianZhuList nested-identity case
// from real ship rows.
function mapHoldJianZhuList(name, guidStrs) {
  const tag = new PropertyTag({
    name:      FName.from(name),
    type:      FName.from('MapProperty'),
    innerType: FName.from('IntProperty'),
    valueType: FName.from('StructProperty'),
  });
  const entries = guidStrs.map((g, i) => ({
    key: i,
    value: new StructValue('SomeStruct', {
      form: 'propStream',
      stream: new PropertyStream({
        properties: [
          (() => {
            // Inner struct: JianZhuIndicator (propStream) containing
            // JianZhuUid (Guid).
            const innerTag = new PropertyTag({
              name:       FName.from('JianZhuIndicator'),
              type:       FName.from('StructProperty'),
              structName: FName.from('JianZhuIndicator'),
              structGuid: FGuid.zero(),
            });
            const innerValue = new StructValue('JianZhuIndicator', {
              form: 'propStream',
              stream: new PropertyStream({
                properties: [guidProp('JianZhuUid', g)],
                terminated: true,
              }),
            });
            return new StructProperty({ tag: innerTag, value: innerValue });
          })(),
        ],
        terminated: true,
      }),
    }),
  }));
  return new MapProperty({ tag, entries });
}

// Wrap a property list in a freshly minted UnrealBlob.
function blobFrom(properties) {
  return new UnrealBlob({
    versionTag: 2,
    stream: new PropertyStream({ properties, terminated: true }),
  });
}

// ---- collectRefs walking shapes ---------------------------------------

console.log('collectRefs: top-level Guid');
{
  const b = blobFrom([guidProp('SelfUid', G_A)]);
  const r = collectRefs(b);
  eq(r.guids,   [{ path: 'SelfUid', guid: G_A }], 'top-level Guid emitted');
  eq(r.objRefs, [],                                'no objRefs');
}

console.log('collectRefs: zero-GUID filtered');
{
  const b = blobFrom([guidProp('SelfUid', G_ZERO), guidProp('Owner', G_A)]);
  const r = collectRefs(b);
  eq(r.guids, [{ path: 'Owner', guid: G_A }], 'zero-GUID skipped, real one kept');
}

console.log('collectRefs: array of Guids');
{
  const b = blobFrom([guidArrayProp('Friends', [G_A, G_B, G_ZERO, G_C])]);
  const r = collectRefs(b);
  eq(r.guids, [
    { path: 'Friends[0]', guid: G_A },
    { path: 'Friends[1]', guid: G_B },
    { path: 'Friends[3]', guid: G_C },
  ], 'array indices in paths; zero filtered');
}

console.log('collectRefs: ObjectRef actor-instance only');
{
  const b = blobFrom([
    objRefProp('Storage',       '/Game/Blueprints/.../BP_BindBGCompActor_C_2143004545'),
    objRefProp('ClassReference', '/Game/Blueprints/.../BP_BindBGCompActor_C'),   // class, not instance
  ]);
  const r = collectRefs(b);
  eq(r.objRefs, [
    { path: 'Storage', targetPath: '/Game/Blueprints/.../BP_BindBGCompActor_C_2143004545' },
  ], 'only the _C_<digits> form is emitted');
}

console.log('collectRefs: nested struct propStream');
{
  const b = blobFrom([mapHoldJianZhuList('MapHoldJianZhuList', [G_A, G_B])]);
  const r = collectRefs(b);
  eq(r.guids, [
    { path: 'MapHoldJianZhuList[0].value.JianZhuIndicator.JianZhuUid', guid: G_A },
    { path: 'MapHoldJianZhuList[1].value.JianZhuIndicator.JianZhuUid', guid: G_B },
  ], 'deep map[N].value.struct.Guid paths');
}

console.log('collectGuids / collectObjRefs (singleton wrappers)');
{
  const b = blobFrom([
    guidProp('SelfUid', G_A),
    objRefProp('Storage', '/Game/Blueprints/X.X_C_99'),
  ]);
  eq(collectGuids(b),   [{ path: 'SelfUid', guid: G_A }], 'collectGuids only emits guids');
  eq(collectObjRefs(b), [{ path: 'Storage', targetPath: '/Game/Blueprints/X.X_C_99' }], 'collectObjRefs only emits objrefs');
}

console.log('collectRefs: null / non-blob input');
{
  eq(collectRefs(null),      { guids: [], objRefs: [] }, 'null safe');
  eq(collectRefs(undefined), { guids: [], objRefs: [] }, 'undefined safe');
  eq(collectRefs({}),        { guids: [], objRefs: [] }, 'plain object — instanceof guard rejects');
}

// ---- Relations: identity routing --------------------------------------

console.log('Relations: SelfUid as identity (default kind path)');
{
  const rel = new Relations();
  const blob = blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_B)]);
  rel.addRow(100, 'npc', blob);
  eq(rel.selfUidOf(100), G_A,    'SelfUid recognized as identity');
  eq(rel.rowBySelfUid(G_A), 100, 'rowBySelfUid reverse');
  const out = rel.outboundFrom(100);
  eq(out, [{ guid: G_B, path: 'Owner', targetSerial: null }], 'Owner is outbound');
  eq(rel.referrersOf(G_A), [],  'identity entry not a referrer');
  eq(rel.referrersOf(G_B), [{ serial: 100, path: 'Owner' }], 'Owner row is a referrer of B');
}

console.log('Relations: player ZhuRenGuid is identity, npc ZhuRenGuid is reference');
{
  const rel = new Relations();
  // Player row: ZhuRenGuid IS the player's identity.
  rel.addRow(1, 'player', blobFrom([guidProp('ZhuRenGuid', G_A)]));
  eq(rel.selfUidOf(1), G_A,     'player ZhuRenGuid acts as identity');
  eq(rel.rowBySelfUid(G_A), 1,  'rowBySelfUid');

  // NPC row owned by that player: ZhuRenGuid is a *reference* pointing
  // back at the player.
  rel.addRow(2, 'npc', blobFrom([
    guidProp('SelfUid',    G_B),
    guidProp('ZhuRenGuid', G_A),
  ]));
  eq(rel.selfUidOf(2), G_B, 'npc SelfUid is identity, not ZhuRenGuid');
  const out = rel.outboundFrom(2);
  eq(out, [{ guid: G_A, path: 'ZhuRenGuid', targetSerial: 1 }],
     'npc ZhuRenGuid resolves to the player');
  eq(rel.referrersOf(G_A), [{ serial: 2, path: 'ZhuRenGuid' }],
     'player has one referrer from the npc');
  eq(rel.referrersOfRow(1), [{ serial: 2, path: 'ZhuRenGuid' }],
     'referrersOfRow convenience');
}

// ---- Relations: ObjectRef + actorNameLookup ---------------------------

console.log('Relations: ObjectRef target resolves via actorNameLookup');
{
  // Inventory row whose actor_name is the full Unreal path; an NPC row
  // owns it via an HBindBGCompActor ObjectRef.
  const inventoryName = '/Game/Blueprints/.../BP_BindBGCompActor_C_2143004545';
  const nameToSerial = new Map([[inventoryName, 200]]);
  const rel = new Relations({ actorNameLookup: (n) => nameToSerial.get(n) ?? null });

  rel.addRow(100, 'npc', blobFrom([
    guidProp('SelfUid', G_A),
    objRefProp('HBindBGCompActor', inventoryName),
  ]));
  rel.addRow(200, 'inventory', blobFrom([guidProp('SelfUid', G_B)]));

  const out = rel.outboundObjRefsFrom(100);
  eq(out, [{ path: 'HBindBGCompActor', targetPath: inventoryName, targetSerial: 200 }],
     'ObjectRef resolved by name lookup');
  eq(rel.referrersByActorName(inventoryName),
     [{ serial: 100, path: 'HBindBGCompActor' }],
     'reverse ObjectRef lookup');
}

// ---- Relations: nested identity (MapHoldJianZhuList) -------------------

console.log('Relations: nested identities not in outbound, but resolvable via rowBySelfUid');
{
  const rel = new Relations();
  // A ship row with two deck-piece sub-entities.
  rel.addRow(500, 'building', blobFrom([
    guidProp('SelfUid', G_A),
    mapHoldJianZhuList('MapHoldJianZhuList', [G_B, G_C]),
  ]));
  // A separate row referencing one of the ship's deck pieces.
  rel.addRow(501, 'npc', blobFrom([
    guidProp('SelfUid',    G_D),
    guidProp('SomeAnchor', G_B),
  ]));

  // The ship's outbound list should NOT include B or C — they're
  // nested identities (inline sub-entities), not references.
  eq(rel.outboundFrom(500), [], 'ship has no outbound (nested identities filtered)');

  // Referrers of G_B: only the second row should count; the ship's own
  // nested-identity entry must be filtered out of referrersOf results.
  eq(rel.referrersOf(G_B), [{ serial: 501, path: 'SomeAnchor' }],
     'referrersOf filters nested-identity entries');

  // rowBySelfUid resolves nested identities to the parent.
  eq(rel.rowBySelfUid(G_B), 500, 'nested deck-piece resolves to the ship');
  eq(rel.rowBySelfUid(G_C), 500, 'second nested deck-piece resolves to the ship');

  // The outbound link from row 501 resolves through the nested-identity
  // mapping back to the ship.
  eq(rel.outboundFrom(501), [{ guid: G_B, path: 'SomeAnchor', targetSerial: 500 }],
     'outbound resolves into ship via nested identity');
}

// ---- Relations: lifecycle ---------------------------------------------

console.log('Relations: dropRow removes all entries');
{
  const rel = new Relations();
  rel.addRow(1, 'npc', blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_B)]));
  rel.addRow(2, 'npc', blobFrom([guidProp('SelfUid', G_B)]));
  expect(rel.stats().rows >= 1, 'rows tracked');
  rel.dropRow(1);
  eq(rel.selfUidOf(1),       null, 'row 1 SelfUid dropped');
  eq(rel.outboundFrom(1),    [],   'row 1 outbound dropped');
  eq(rel.referrersOf(G_B),   [],   'row 1\'s entry removed from referrers bucket');
  eq(rel.rowBySelfUid(G_A),  null, 'row 1\'s identity removed from reverse map');
  // Row 2 still present.
  eq(rel.selfUidOf(2),       G_B,  'row 2 unaffected');
}

console.log('Relations: refreshRow swaps in new blob');
{
  const rel = new Relations();
  rel.addRow(1, 'npc', blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_B)]));
  // Edit: change Owner.
  rel.refreshRow(1, 'npc', blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_C)]));
  eq(rel.referrersOf(G_B), [],                              'old reference gone');
  eq(rel.referrersOf(G_C), [{ serial: 1, path: 'Owner' }], 'new reference present');
  eq(rel.selfUidOf(1),     G_A,                              'identity unchanged');
}

console.log('Relations: clear wipes everything');
{
  const rel = new Relations();
  rel.addRow(1, 'npc', blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_B)]));
  rel.clear();
  eq(rel.stats(), { rows: 0, rowsWithSelfUid: 0, distinctGuids: 0, totalRefs: 0 },
     'all maps empty after clear');
}

// ---- Relations: stats --------------------------------------------------

console.log('Relations: stats accuracy');
{
  const rel = new Relations();
  rel.addRow(1, 'npc', blobFrom([guidProp('SelfUid', G_A), guidProp('Owner', G_B)]));
  rel.addRow(2, 'npc', blobFrom([guidProp('SelfUid', G_C)]));
  const s = rel.stats();
  eq(s.rowsWithSelfUid, 2, 'two rows with SelfUid');
  eq(s.distinctGuids,   3, 'three distinct guids: A, B, C');
  eq(s.totalRefs,       3, 'three guid entries (2 identity + 1 outbound)');
}

// ---- constants exposed -------------------------------------------------

console.log('exported constants');
expect(IDENTITY_PATH_BY_KIND.player === 'ZhuRenGuid', 'player identity path');
expect(DEFAULT_IDENTITY_PATH === 'SelfUid',           'default identity path');

// ---- summary -----------------------------------------------------------

if (fails > 0) {
  console.error(`\n${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nrelations: all assertions passed');
