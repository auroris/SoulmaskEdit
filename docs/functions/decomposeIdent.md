[**wsedit**](../README.md)

***

[wsedit](../README.md) / decomposeIdent

# Function: decomposeIdent()

> **decomposeIdent**(`token`, `glossLookup`): `string`

Defined in: translate-ident.mjs:35

Decompose a single token, walking PascalCase boundaries to find the
longest prefix the glossLookup recognizes. Recurses on the remainder.
Tokens that the lookup doesn't recognize at any prefix length pass
through unchanged.

## Parameters

### token

`string`

### glossLookup

(`t`) => `string`

## Returns

`string`
