[**wsedit**](../README.md)

***

[wsedit](../README.md) / parseTransform

# Function: parseTransform()

> **parseTransform**(`transf`): `object`

Defined in: transform.mjs:34

Parse an actor_transf string into structured form.
Returns null on any malformed component (wrong segment count, non-finite
numbers, missing triples).

## Parameters

### transf

`string`

## Returns

`object`

### pos

> **pos**: \[`number`, `number`, `number`\]

### rot

> **rot**: \[`number`, `number`, `number`\]

### scale

> **scale**: \[`number`, `number`, `number`\]
