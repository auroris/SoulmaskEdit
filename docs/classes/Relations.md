[**wsedit**](../README.md)

***

[wsedit](../README.md) / Relations

# Class: Relations

Defined in: relations.mjs:92

## Constructors

### Constructor

> **new Relations**(`options?`): `Relations`

Defined in: relations.mjs:103

#### Parameters

##### options?

###### kindLookup?

(`serial`) => `string` = `null`

Resolve serial → classify().kind. When absent, identity falls
  back to DEFAULT_IDENTITY_PATH for every row.

###### actorNameLookup?

(`actorName`) => `number` = `null`

Resolve an ObjectRef's targetPath (= target row's actor_name) to
  its serial. When absent, `outboundObjRefsFrom` returns entries
  with `targetSerial: null` — the index still tracks the path.

#### Returns

`Relations`

## Properties

### \_kindLookup

> **\_kindLookup**: (`serial`) => `string`

Defined in: relations.mjs:104

#### Parameters

##### serial

`number`

#### Returns

`string`

***

### \_actorNameLookup

> **\_actorNameLookup**: (`actorName`) => `number`

Defined in: relations.mjs:105

#### Parameters

##### actorName

`string`

#### Returns

`number`

***

### \_guidIndex

> **\_guidIndex**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:107

***

### \_outboundByRow

> **\_outboundByRow**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:108

***

### \_selfUidByRow

> **\_selfUidByRow**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:109

***

### \_rowBySelfUid

> **\_rowBySelfUid**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:110

***

### \_nestedIdentitiesByRow

> **\_nestedIdentitiesByRow**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:111

***

### \_outboundObjRefsByRow

> **\_outboundObjRefsByRow**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:112

***

### \_objRefReferrersByName

> **\_objRefReferrersByName**: `Map`\<`any`, `any`\>

Defined in: relations.mjs:113

***

### \_totalRefs

> **\_totalRefs**: `number`

Defined in: relations.mjs:114

## Methods

### setKindLookup()

> **setKindLookup**(`fn`): `void`

Defined in: relations.mjs:118

Replace the kind lookup. Existing rows are NOT re-indexed; call refreshRow if needed.

#### Parameters

##### fn

`any`

#### Returns

`void`

***

### setActorNameLookup()

> **setActorNameLookup**(`fn`): `void`

Defined in: relations.mjs:120

Replace the actor-name lookup. ObjectRef queries pick up the new resolution on next call.

#### Parameters

##### fn

`any`

#### Returns

`void`

***

### addRow()

> **addRow**(`serial`, `kind`, `blob`): `void`

Defined in: relations.mjs:138

Add (or re-index) a row. `kind` is the row's classify().kind — used
to pick the identity path. `blob` is a decoded UnrealBlob
(or anything `collectRefs` accepts). Pass `blob = null` to drop the
row's references without removing it; pass `blob` empty for a
"no references" row.

Idempotent: calling addRow twice for the same serial replaces the
prior entries.

#### Parameters

##### serial

`number`

##### kind

`string`

##### blob

`UnrealBlob`

#### Returns

`void`

***

### refreshRow()

> **refreshRow**(`serial`, `kind`, `blob`): `void`

Defined in: relations.mjs:154

Re-index a single row after an edit. Equivalent to addRow with the
row's current kind (which addRow already takes as a parameter); kept
as a separate method for parity with the SoulmaskDB surface.

#### Parameters

##### serial

`number`

##### kind

`string`

##### blob

`UnrealBlob`

#### Returns

`void`

***

### dropRow()

> **dropRow**(`serial`): `void`

Defined in: relations.mjs:163

Drop one row's entries. Used after a delete.

#### Parameters

##### serial

`number`

#### Returns

`void`

***

### clear()

> **clear**(): `void`

Defined in: relations.mjs:168

Reset all indexed state.

#### Returns

`void`

***

### referrersOf()

> **referrersOf**(`guid`): `object`[]

Defined in: relations.mjs:189

Every row that mentions `guid` at a non-identity property — "who
points AT this guid?". Identity and nested-identity entries are
filtered out at query time.

#### Parameters

##### guid

`string`

#### Returns

`object`[]

***

### referrersOfRow()

> **referrersOfRow**(`serial`): `object`[]

Defined in: relations.mjs:208

Convenience: who points at the row whose identity-GUID we look up
by `serial`. Returns `[]` if the row has no identity (some metadata
rows don't).

#### Parameters

##### serial

`number`

#### Returns

`object`[]

***

### selfUidOf()

> **selfUidOf**(`serial`): `any`

Defined in: relations.mjs:215

Row's identity guid (under its kind's identity path), or null.

#### Parameters

##### serial

`any`

#### Returns

`any`

***

### rowBySelfUid()

> **rowBySelfUid**(`guid`): `any`

Defined in: relations.mjs:220

Reverse: which row claims this guid as its identity, or null.

#### Parameters

##### guid

`any`

#### Returns

`any`

***

### outboundFrom()

> **outboundFrom**(`serial`): `object`[]

Defined in: relations.mjs:231

Every GUID this row references (identity excluded), with the
resolved target serial when one is loaded.

#### Parameters

##### serial

`number`

#### Returns

`object`[]

***

### outboundObjRefsFrom()

> **outboundObjRefsFrom**(`serial`): `object`[]

Defined in: relations.mjs:253

Every actor-instance ObjectRef this row points at, with the target
resolved to a serial via `actorNameLookup`.

#### Parameters

##### serial

`number`

#### Returns

`object`[]

***

### referrersByActorName()

> **referrersByActorName**(`actorName`): `object`[]

Defined in: relations.mjs:277

Reverse lookup: which rows reference an actor whose `actor_name`
equals `actorName`? Used by the compound-object logic to find the
parent of an inventory row whose owner points at it via
HBindBGCompActor or similar.

#### Parameters

##### actorName

`string`

#### Returns

`object`[]

***

### stats()

> **stats**(): `object`

Defined in: relations.mjs:283

#### Returns

`object`

##### rows

> **rows**: `number`

##### rowsWithSelfUid

> **rowsWithSelfUid**: `number`

##### distinctGuids

> **distinctGuids**: `number`

##### totalRefs

> **totalRefs**: `number`

***

### \_identityPathFor()

> **\_identityPathFor**(`kind`): `any`

Defined in: relations.mjs:294

#### Parameters

##### kind

`any`

#### Returns

`any`

***

### \_absorb()

> **\_absorb**(`serial`, `kind`, `refs`): `void`

Defined in: relations.mjs:301

#### Parameters

##### serial

`any`

##### kind

`any`

##### refs

`any`

#### Returns

`void`

***

### \_removeRow()

> **\_removeRow**(`serial`): `void`

Defined in: relations.mjs:359

#### Parameters

##### serial

`any`

#### Returns

`void`

***

### \_dropFromBucket()

> **\_dropFromBucket**(`guid`, `serial`): `void`

Defined in: relations.mjs:400

#### Parameters

##### guid

`any`

##### serial

`any`

#### Returns

`void`
