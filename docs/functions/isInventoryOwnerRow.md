[**wsedit**](../README.md)

***

[wsedit](../README.md) / isInventoryOwnerRow

# Function: isInventoryOwnerRow()

> **isInventoryOwnerRow**(`rowOrResult`): `boolean`

Defined in: classify.mjs:278

Structural role predicate — can this row OWN inventory? True for
top-level world entities (anything in wscodec's npcs or buildings, plus
the player). Determined from the row's classified kind.

## Parameters

### rowOrResult

\{ `kind?`: `string`; \} \| \{ `_kind?`: `string`; \}

## Returns

`boolean`
