# Soulmask save-edit helpers — handoff notes

Notes for bootstrapping a separate "helpers" project on top of [wscodec](https://github.com/auroris/SoulmaskCodec). The codec gives you faithful bytes-in/bytes-out for Soulmask's `actor_data` blobs and the surrounding SQLite envelope. The helpers project's job is to add a *data-model layer* on top: knowing which actors reference which, what counts as a "thing" (an NPC, a base, a ship), and how to copy/relocate/edit those things without breaking references.

This document was written after a session that took the codec from "decodes 100% of rows byte-identically" to "edits survive game load":

- Chest renamed in-game by editing FText displayStrings
- NPC's NamedFormat log entry rendered with substituted X/Y/Z arguments after editing the sourceFmt
- A blackstone wall visibly moved by editing `RelativeTransform`

The data-model knowledge below was learned through that process; treat it as known-true on the *tested save* but version-dependent on Soulmask updates. Re-validate when the game patches.

---

## 1. What the codec gives you

Import surface from `wscodec.mjs`:

```js
import {
  UnrealBlob,
  blobToJSON, jsonToBlob,           // object-tree round trip
  blobToJSONString, jsonStringToBlob, // JSON.stringify wrappers with -0/NaN/Infinity sentinels
  jsonReplacer, jsonReviver,        // reuse these if you build larger JSON envelopes around blobs
  FName, FGuid,                     // primitives
  PropertyTag, Property,            // raw tree types
  ArrayValue, SetValue, MapValue,
  StructValue, STRUCT_HANDLERS, registerStructHandler,
  ObjectRef, SoftObjectRef, FTextValue, OpaqueValue,
} from 'wscodec';
```

Two encoder modes:

| Mode | When | Effect |
|---|---|---|
| `_dirty = false` (default) | Pass-through | `serialize()` returns the original input bytes verbatim |
| `_dirty = true`, `_recomputeSizes = false` | Direct codec edits where you know `tag.size` still matches | Re-emits from properties; uses stored `tag.size` literally |
| `_dirty = true`, `_recomputeSizes = true` | Anything mutated (FString lengths, FText, etc.) | Re-emits and rewrites every `PropertyTag.size` from the actual value byte count. **This is what `jsonToBlob` sets.** |

If you edit through JSON, you don't need to think about modes — `jsonStringToBlob` does the right thing. If you edit the live decoded tree directly, set `blob._dirty = true; blob._recomputeSizes = true` before `serialize()` unless you're confident the byte counts didn't change.

LZ4 and SQLite are NOT in the codec. The `scripts/db-to-json.mjs` / `scripts/json-to-db.mjs` pair in this repo show the LZ4-decompress + version-tag handling around the codec; lift that code wholesale for the helpers project.

---

## 2. SQLite layer — actor_table

The save db has two real tables:

- `actor_table` — every persistable thing in the world (actors, building zones, inventory holders, NPCs, the GameMode itself).
- `sqlite_sequence` — SQLite's AUTOINCREMENT counter, one row keyed by `'actor_table'`. When you create new actors, the counter advances.

`actor_table` columns relevant to helpers:

| Column | Type | What | Notes |
|---|---|---|---|
| `actor_serial` | INTEGER PK AUTOINCREMENT | Stable in-save id | Not portable across saves. Anywhere you copy/import, allocate fresh serials. |
| `server_id` | INTEGER | Shard id | Same value for all rows in single-player saves. |
| `data_version` | INTEGER | **Negative** of the wire DataVersion | A healthy blob is `data_version = -2`; the *bytes* contain `0x00000002`. |
| `actor_name` | TEXT | UE asset path + unique suffix | e.g. `.../BP_GongZuoTai_JinShuXiang_C_2147247542`. Treat as opaque; useful only for grepping the db. |
| `actor_level` | TEXT | (not investigated) | |
| `actor_script` | TEXT | Class path | e.g. `/Game/Blueprints/JianZhu/GongZuoTai/BP_GongZuoTai_JinShuXiang.BP_GongZuoTai_JinShuXiang_C`. **Primary key for "what kind of thing is this?"** |
| `actor_owner` | TEXT | Often empty | (not investigated) |
| `actor_transf` | TEXT | World position, plain text | Format: `tx,ty,tz\|pitch,yaw,roll\|sx,sy,sz`. **Outside the wscodec blob.** Edit this column directly to move a placed actor. |
| `actor_data` | BLOB | The wscodec payload | `[u32 LE version=0x02][LZ4 block]`. The codec consumes the LZ4-decompressed inner bytes. |
| `actor_time` | TEXT | (not investigated) | |

Indexes: there are 5 (`actor_level`, `actor_name`, `actor_script`, `data_version`, `server_id`). The helpers' import pipeline should drop these before bulk inserts and re-add after — `scripts/json-to-db.mjs` does this and saves about an order of magnitude on rebuild time.

---

## 3. The `actor_data` model

After `UnrealBlob.decode`, each row's blob is:

```js
{
  versionTag: 2,
  terminated: true,
  properties: [
    { tag: PropertyTag, value: <type-dispatched> },
    ...
  ],
  bodyTrailing: null   // very rare; bytes after the None terminator
}
```

`tag.type.value` drives value interpretation. The big ones:

| Property type | JS shape | Notes |
|---|---|---|
| Int/Float/Double/Bool/Str | primitive | |
| Int64/UInt64 | string (decimal) | Avoid `Number` precision loss. |
| Name/Enum/ByteProperty(with enumName) | `FName` (toJSON → bare string) | |
| ObjectProperty (and Class/Weak/Lazy/WS variants) | `ObjectRef` | See §4. |
| SoftObjectProperty | `SoftObjectRef` | |
| StructProperty | `StructValue` in one of three forms | See §5. |
| ArrayProperty | `ArrayValue` | Contains `elements`, optional `_arrayInnerTag` for struct arrays, optional `_perElementTrailings`. |
| SetProperty | `SetValue` | Rare (saw 2 rows in 12,446). |
| MapProperty | `MapValue` | Has `removed` + `entries: [{key, value}]`. |
| TextProperty | `FTextValue` | historyType 0/1/2 supported; 4 partially; others fall back to `_raw`. |

---

## 4. ObjectRef — the universal "actor reference"

`ObjectRef` is how one actor points at another. It carries up to four pieces of information, any subset of which may be on the wire:

```js
new ObjectRef({
  kind: 3,                          // u8; observed 0, 1, 3, 9
  kindOnePrefix: null,              // u32, ONLY when kind === 1 (Soulmask actor-ref quirk)
  path: '/Game/.../SomeActor_C_12345',
  classPath: '/Game/.../SomeActor_C',
  embedded: [Property, ...],        // nested property stream — common for component refs
  pathIsNull, classPathIsNull, hasTerminatorTrailer,  // wire-form preservation flags
})
```

**Common kinds (empirical):**

- `kind=0` — null/none reference (just the kind byte).
- `kind=1` — hard reference to an actor in the same world (the `kindOnePrefix` is observed always = 1).
- `kind=3` — most-common reference shape. Often carries `path + classPath + embedded`.
- `kind=9` — observed on item-class references (e.g. `DaoJuClass` pointing to an item blueprint). Path-only.

**Resolving a reference:** if `path` looks like `...PersistentLevel.<ClassName>_C_<number>`, the trailing `<number>` is *not* an `actor_serial` — it's the UE actor's unique-instance number from the original world save. To find the actor in `actor_table`, match by the FULL `path` against the `actor_name` column.

The `embedded` field is what makes Soulmask's data dense: a single ObjectRef can carry an entire component's property tree inline (e.g., the chest's `BindBaoGuoActor` ref includes a full nested stream for the bound inventory actor's state).

---

## 5. StructValue — three forms

Discriminated by shape:

1. **Binary handler** (Vector, Quat, Transform, Guid, DateTime, Color, etc.) — `value` is a plain object or string. Decoded/encoded by `STRUCT_HANDLERS[name]`. Registered set is in [structs.mjs](../structs.mjs).
2. **PropStream** (unknown struct names) — `value` is a `Property[]`, plus a `terminated` boolean. Useful for inspecting nested data without writing handlers.
3. **Decode-error** (rare) — `value: []`, `_structDecodeError`, `_opaqueTail`. Codec gave up; bytes preserved opaquely.

To add a new known-binary struct, call `registerStructHandler(name, { read, write })`. After registration, subsequent decodes use the binary path for that name.

---

## 6. Cross-actor reference patterns we've found

These are the edges of the data graph the helpers project needs to traverse.

### Chest / workbench / bonfire → bound inventory

```
ChestActor (BP_GongZuoTai_*_C)
  ├─ JianZhuDisplayName: FText
  ├─ bPlayerChangedName: bool
  ├─ BindBaoGuoActor: ObjectRef → inventory actor
  ├─ JianZhuBuilderUid: Guid  ─────────────┐
  ├─ JianZhuUid: Guid (this chest's id)    │ (player Guid)
  ├─ JianZhuSid: UInt64 (numeric id)       │
  ├─ JianZhuHP / MaxJianZhuHP: float       │
  ├─ RongQiCunQuRiZhiData: Array<RongQiCunQuRiZhiData> (access log)
  ├─ MeBuildOnWhich: StructProperty<...> (which surface it's on)
  ├─ PingTaiCharacter: ObjectRef → ship actor (when placed on a ship)
  └─ ...

InventoryActor (BP_BGActor_JianZhu_RongQi_C, separate actor_serial)
  └─ BaoGuoComponent: ObjectRef.embedded
      ├─ BaoGuoDaoJuList.DaoJuEntries: Array<DaoJuEntry, size=132>
      │   └─ each entry: DaoJu: ObjectRef.embedded
      │       ├─ Uid: Guid (item instance)
      │       ├─ Amount: int
      │       ├─ BGIndex: int
      │       ├─ NaiJiuDu / MaxNaiJiuDu: int (durability)
      │       └─ ...
      ├─ KuaiJieLanComponent, ZhuangBeiLanComponent, ... (quick-bar, equipment, fuel, etc.)
      └─ UpcomingItemDecayTime: double
```

Notes:
- **Iron ingot test confirmed:** editing `Amount` survives load. The chest's display name and access log also survive *if `tag.size` is recomputed*.
- The chest and the inventory actor are a **pair** referenced via `BindBaoGuoActor`. Copying a chest means copying both.

### Building zone (JianZhuPianQu) → placed pieces

```
JianZhuPianQu actor (snapped to a coarse grid; actor_transf is the tile origin)
  └─ JianZhuInstGLQComponent: ObjectRef.embedded
      ├─ JianZhuInstYuanXings: Array<ObjectRef.embedded>   // ONE element per prototype (wall, foundation, etc.)
      │   └─ each prototype carries:
      │       ├─ MapInstJianZhuDataList: Map<Guid, struct>  // ONE entry per placed piece of that prototype
      │       │   └─ each entry value contains:
      │       │       ├─ JianZhuUid: Guid (piece id)
      │       │       ├─ ZhuRenUid, GongHuiUid, JianZhuBuilderUid: ownership Guids
      │       │       ├─ JianZhuSid: UInt64
      │       │       ├─ JianZhuBuilderName / JianZhuBuilderNameText
      │       │       ├─ **RelativeTransform: StructProperty<Transform>**  ← visual placement
      │       │       ├─ JianZhuHP: float
      │       │       ├─ HookedJianZhues: Array<{JianZhuUid, JianZhuStoreName}>  // hierarchical refs to attached pieces (3 entries per piece, role unclear)
      │       │       ├─ WhichBuildOnMe, MeBuildOnWhich
      │       │       └─ ...
      │       ├─ JianZhuYuanXingName: FString (the prototype class name)
      │       └─ JianZhuYuanXingClass: ObjectRef
      ├─ MapWaitingXiuLiJianZhues
      └─ MapHoldJianZhuList
```

**The two-places-the-same-data trap:** each prototype's `ArrayValue` also has a `_perElementTrailings` cache, one entry per placed piece, containing:

- `transforms`: array of 16-float row-major `FMatrix` per piece (same data as RelativeTransform)
- `ids`: array of u32 per piece (or float32 reinterpreted — observed values like 0x3DCCCCCD = 0.1, 0x3F4CCCCD = 0.8)
- `aux`: array of 16-float matrices per piece, count typically == transforms.length or one more

**Confirmed in-game:** Soulmask renders from `RelativeTransform`, not from `perElementTrailings`. The trailings are some kind of render-side instanced-mesh cache. *Editing only `perElementTrailings` has no visible effect*. To move a piece, edit `RelativeTransform.Translation` and update the matching `perElementTrailings.transforms[i][12..14]` (rotation+scale also live in the matrix; sync them too if changed).

**Helper candidate:** `setPieceTransform(zone, group, piece, {translation, rotation, scale})` that updates both representations atomically.

### NPC → bound inventory + camp logs

NPCs use the same `BP_BindBGCompActor` pattern as chests for their inventory. The NPC actor's `actor_data` carries their stats, talents, and `JingYingRiZhiList` (work log). Each log entry is a struct with:

- `RiZhiDateTime`: `StructProperty<DateTime>` (`.NET` ticks)
- `Type`: int (the log-line template id — determines the localized verb/template the UI uses)
- `ParamArrayTxt`: `Array<TextProperty>` — placeholder values for the template, may include `historyType=0` (localized name), `historyType=1` (NamedFormat with X/Y/Z args), `historyType=-1` (raw display string)

To force the engine to render an FText literally instead of a localization lookup: set `namespace = ""` and `key = ""`, and put your text in `sourceString`.

### Ownership / clan / player tables — GameMode actor

The "GameMode" actor (in the tested save: `actor_serial = 11`, `actor_script = .../BP_GameModeBase_DLC_C`) holds the global registries that link players, characters, and buildings:

```
GameMode (actor_serial 11)
  ├─ HGongHuiGuanLiQi: ObjectRef.embedded
  │   ├─ GeRenJianZhuYingHuoList: Map<PlayerGuid, ...>   // per-player build/activity?
  │   ├─ PlayerGongHuiMap: Map<PlayerGuid, ClanGuid>     // player → clan
  │   ├─ PlayerGongHuiDataMap: Map<PlayerGuid, ClanData>
  │   ├─ GongHuiMap: Map<ClanGuid, ClanInfo>
  │   ├─ GeRenJianZhuYingHuoList: ...
  │   └─ MapGuidToSteamId: Map<PlayerGuid, SteamId>      // bridges to Steam
  ├─ HBiaoJiGuanLiQi: ObjectRef.embedded
  │   └─ GeRenBiaoJiMap: Map<PlayerGuid, ...>            // per-player map markers
  └─ ...
```

**To re-assign ownership of a copied actor:**
- Update the actor's own `JianZhuBuilderUid` / `ZhuRenUid` / `GongHuiUid` (whichever appear on its class).
- Update the GameMode's `PlayerGongHuiMap` / `GeRenJianZhuYingHuoList` entries if the new owner doesn't already exist.
- For NPCs: also update whichever map links player → owned NPCs (not investigated yet).

There's a separate `BP_WenMingGuanLiQi_C` actor with `MapGeRenWenMingGradeBiao` — player civilization/progression. Probably matters for player-character copies; haven't dug in.

---

## 7. Edit gotchas (the things we learned the hard way)

- **`tag.size` is wire-authoritative and must match the actual value byte count.** Stale sizes after editing a variable-length field (FString, FText, nested struct) cause Soulmask to mis-read everything that follows — observed effect was the chest losing its name, log, AND ownership on game load. The codec's `_recomputeSizes = true` mode (set by `jsonToBlob`) fixes this.
- **FString length changes inside structs cascade outward.** The outer `tag.size` *and* every intermediate array/struct `tag.size` need to grow with the field. `_recomputeSizes` handles this.
- **`JSON.stringify(-0) === "0"`** — and Soulmask wire format preserves `-0`. The codec's `blobToJSONString` / `jsonStringToBlob` substitutes sentinel strings; preserve them through any JSON pipeline.
- **NaN bit patterns aren't all equal.** Soulmask aux data uses `0xFFFFFFFF` (a non-canonical NaN) as a sentinel; JS Number collapses all NaNs to `0x7FC00000`. The codec wraps non-canonical NaN floats in `perElementTrailings` as `{ $nanBits }`; if you write a helper that touches floats elsewhere, watch for the same issue.
- **LZ4 has multiple valid encodings.** The column bytes after re-encode WILL differ from the original even when the uncompressed payload is byte-identical. Diff at the uncompressed level (`scripts/diff-dbs.mjs` does this).
- **The `_perElementTrailings` cache must be updated alongside `RelativeTransform`** for any piece move (see §6).
- **Soulmask validates referenced player names.** When we set the chest's access log operator to "AutoTest" (a name no real player had), the *log entry survived* the load but the broader cascade from the size-mismatch happened to also wipe the log. We never separately confirmed whether unknown operator names alone trigger validation — worth re-testing once the helpers project lands.
- **Don't change `bPlayerChangedName` casually.** It controls whether `JianZhuDisplayName` is honored vs. the class default; mismatching state may behave oddly.
- **Mod content** lives at paths like `/MOD2A5N2VOU7YUIV7X6SJG04WY7Q/...` (a mod GUID prefix). Cross-save copy needs to assume the target save has the same mods loaded.

---

## 8. Specific known IDs from the tested save

For grounding new tools against the world we've already mapped (`world_mannual_1.db`, player Aleena, DLC island save):

| What | Identifier |
|---|---|
| Player Aleena's PlayerUid | `C843A973-AA2D-4A30-A5CF-D529A4CDB028` |
| GameMode actor | serial 11 |
| Civilization manager | serial 377 (`BP_WenMingGuanLiQi_C`) |
| Aleena's ship (Ship_03) | serial 12583 |
| Egyptian Exile NPC used in tests | serial 307 (`BP_EgyptDLC_Exiles_F_C` = `(JER)Warrior3`) |
| Test chest "Claude's Cabinet" | serial 43299 (chest) + 43298 (bound inv) |
| Test "Blackstone House" zone | serial 43317 |
| Blackstone bonfire (mod) | serial 43319 (`/MOD2A5N2VOU7YUIV7X6SJG04WY7Q/Bonfire_3.Bonfire_3_C`) |

These were stable across our test runs; they'll change in any other save.

---

## 9. Suggested helpers architecture

```
helpers/
├── codec-wrap.js      // open db, decode/encode actor_data with LZ4
├── db.js              // SQLite query helpers (findByName, findByScript, findNearby)
├── refs.js            // ObjectRef resolution; Guid rewriting; iterate-all-refs
├── ownership.js       // GameMode table reads/writes
├── ops/
│   ├── copy-npc.js
│   ├── copy-base.js
│   ├── transfer-ship.js
│   └── edit-player.js
└── cli/
    ├── copy-npc.mjs   // thin wrappers exposing ops/* as CLIs
    └── ...
```

### Core primitives to land first

```js
// db.js
findActorsByScript(db, scriptGlob)        // 'BP_GongZuoTai_*'
findActorByName(db, exactName)            // matches actor_name column
findActorsNear(db, [x,y,z], radius)
findActorByUid(db, uidGuid)               // searches for any property's Guid == uid

// refs.js
walkProperties(blob, visitor)             // depth-first visit of every Property in the tree
findAllRefs(blob)                         // returns [{ path, classPath, kind, position }] for every ObjectRef
findAllGuids(blob)                        // returns [{ path, guid }]
rewriteGuids(blob, mapping)               // in-place rewrite using Map<oldGuid, newGuid>
rewritePaths(blob, oldName, newName)      // for re-targeting ObjectRef.path strings
allocateGuid()                            // new random FGuid
allocateActorSerial(db)                   // next AUTOINCREMENT value

// ownership.js
loadGameMode(db) → { gameModeBlob, save }
getPlayerClan(gameMode, playerUid)
addPlayerToClan(gameMode, playerUid, clanUid)
reassignBuilderUid(blob, newUid)          // updates JianZhuBuilderUid/Text on all matching properties

// ops/copy-npc.js
copyNpc(srcDb, npcSerial, destDb, newOwnerUid) → { newSerial }
  // 1. Decode src NPC blob + its bound BG actor
  // 2. Allocate new serials and Guids
  // 3. Rewrite refs (BindBGCompActor path, all internal Guids)
  // 4. Reassign builder/owner Uids
  // 5. Insert into destDb, advance AUTOINCREMENT, update sqlite_sequence
  // 6. Update GameMode registries on destDb
```

### Open design questions

- **Where does crew assignment live?** A ship has `RaftSpaceAsCrew` properties on its associated NPCs (we saw this in the find-string search on Ship_03). Cross-map ship transfer needs to either bring crew or sever ties. Investigate the `RaftSpaceAsCrew` path.
- **Are there per-map prototype tables?** A ship hull piece from the DLC island might have a class path that doesn't exist on Cloud Mist Forest. The helpers need a way to *check* class-path validity against the target save's content set before importing.
- **Per-piece "hooked" graph.** Each placed piece has a `HookedJianZhues: [{JianZhuUid, JianZhuStoreName}]` array with consistently 3 entries. Meaning unclear; probably structural adjacency (parent + neighbor + something). If we move pieces, do these need re-linking?
- **`actor_transf` vs. piece-internal transforms.** Most placed pieces have `actor_transf` empty in the column but `RelativeTransform` in their zone entry. Ships and bonfires DO have `actor_transf`. Helpers need to know which case applies before relocating.
- **AUTOINCREMENT and `sqlite_sequence`.** The importer in this repo updates `sqlite_sequence` by REPLACE-on-name semantics. For incremental inserts (not bulk re-create), a helper can just INSERT new rows and let SQLite update the counter; only need to touch `sqlite_sequence` if you want to PRE-set the next id for some reason.

---

## 10. Things to validate when Soulmask patches

The data shapes above are stable as of this session, but Soulmask is in active development. If the codec ever shows up with new `_sizeMismatch` rows or new `OpaqueValue` reasons, you've hit a wire-format change. Specifically:

- New `FText` history types (we don't handle 3, 5–12 — they fall back to `_raw`).
- New `StructProperty` names without binary handlers (we'll auto-fall-back to property-stream form, which is usually fine).
- Changes to the inflated-tag.size patterns in Maps (currently we don't trigger `_sizeMismatch` on any row; that's a regression signal).
- Changes to the `JianZhuInstYuanXings` perElementTrailings shape (we asserted strides of 64/4/64 — if those change, the helper script will throw on read).

The existing test harness in this repo (`test/test-roundtrip.mjs` + `test/test-json-full.mjs` + `scripts/diff-dbs.mjs`) should be the canary. Run it after every Soulmask update.

---

## 11. Useful one-off scripts already in this repo

Lift as reference for the helpers project:

| Script | Purpose |
|---|---|
| [scripts/db-to-json.mjs](../scripts/db-to-json.mjs) | Full db export, streaming JSON write. Handles LZ4 + actor_data decode dispatch. |
| [scripts/json-to-db.mjs](../scripts/json-to-db.mjs) | Inverse. Creates schema, bulk-inserts in one transaction, restores indexes after. |
| [scripts/diff-dbs.mjs](../scripts/diff-dbs.mjs) | Per-row uncompressed diff (LZ4-tolerant). |
| [scripts/find-string.mjs](../scripts/find-string.mjs) | Grep across all decoded property trees for a substring (UIDs, names, paths). |
| [scripts/dump-actor.mjs](../scripts/dump-actor.mjs) | Pretty-print one actor's full property tree to JSON. |
| [scripts/test-edit-chest.mjs](../scripts/test-edit-chest.mjs) | Example edit script (chest name, ingot count, log). |

The pattern they all share — read db → decompress LZ4 → `UnrealBlob.decode` → mutate → `jsonStringToBlob` round-trip OR direct mutate + `serialize({recomputeSizes: true})` → LZ4-compress → write column — is what every helper operation will be built around.
