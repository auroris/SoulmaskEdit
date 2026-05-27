[**wsedit**](../README.md)

***

[wsedit](../README.md) / RULES

# Variable: RULES

> `const` **RULES**: `Readonly`\<\{ `kind`: readonly (\{ `name`: `"GAME_SETTINGS"`; `kind`: `string`; `summary`: `string`; `script?`: `undefined`; `scriptContains?`: `undefined`; \} \| \{ `name`: `"GAMEMODE"`; `kind`: `string`; `summary`: `string`; `script?`: `undefined`; `scriptContains?`: `undefined`; \} \| \{ `name?`: `undefined`; `script`: `"/Script/WS.HPlayerState"`; `kind`: `string`; `summary`: `string`; `scriptContains?`: `undefined`; \} \| \{ `name?`: `undefined`; `script?`: `undefined`; `summary?`: `undefined`; `scriptContains`: `string`[]; `kind`: `string`; \} \| \{ `name?`: `undefined`; `script?`: `undefined`; `summary?`: `undefined`; `scriptContains`: `string`; `kind`: `string`; \})[]; `subKind`: `Readonly`\<\{ `npc`: readonly `object`[]; `building`: readonly (\{ `scriptContains`: `string`[]; `subKind`: `string`; \} \| \{ `scriptContains`: `string`; `subKind`: `string`; \})[]; \}\>; \}\>

Defined in: classify.mjs:149

Read-only access to the rule tables — UI introspection and tests.
