[**wsedit**](../README.md)

***

[wsedit](../README.md) / SUBKINDS\_BY\_KIND

# Variable: SUBKINDS\_BY\_KIND

> `const` **SUBKINDS\_BY\_KIND**: `Readonly`\<\{ `npc`: readonly `string`[]; `building`: readonly `string`[]; \}\>

Defined in: classify.mjs:83

UI-driven subKind refinements organized by primary kind. classify() may
return one of these for `subKind`, or null when no rule matched (or
when the primary kind doesn't define subKinds).
