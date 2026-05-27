[**wsedit**](../README.md)

***

[wsedit](../README.md) / classify

# Function: classify()

> **classify**(`row`): `object`

Defined in: classify.mjs:179

Classify an actor_table row.

## Parameters

### row

#### actor_name?

`string`

#### actor_script?

`string`

#### actor_transf?

`string`

## Returns

`object`

### kind

> **kind**: `string`

### subKind

> **subKind**: `string`

### label

> **label**: `string`

### summary

> **summary**: \{ `type`: `"key"`; `key`: `string`; \} \| \{ `type`: `"generic"`; `ident`: `string`; `pos`: \[`number`, `number`, `number`\]; `bearing`: `string`; \}
