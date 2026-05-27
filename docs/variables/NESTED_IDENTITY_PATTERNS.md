[**wsedit**](../README.md)

***

[wsedit](../README.md) / NESTED\_IDENTITY\_PATTERNS

# Variable: NESTED\_IDENTITY\_PATTERNS

> `const` **NESTED\_IDENTITY\_PATTERNS**: readonly `RegExp`[]

Defined in: relations.mjs:81

Path patterns identifying sub-entity GUIDs that live inline inside a
parent row's blob — e.g. deck pieces of a ship live under
`MapHoldJianZhuList[N].value.JianZhuIndicator.JianZhuUid` on the ship's
row, with no standalone actor_table row of their own. Without this
list those GUIDs would flow into `_outboundByRow` as outbound
references (each rendering as "target not in loaded set") and pollute
`referrersOf` results.

Matching path entries are:
  - excluded from the row's outbound list (they aren't references TO
    something else; they ARE this row's sub-identities)
  - registered in `_rowBySelfUid` so OTHER rows that reference one of
    these sub-entity GUIDs resolve back to this parent row
  - excluded from `referrersOf` (a sub-identity isn't a referrer)
  - NOT placed in `_selfUidByRow` (that holds the primary identity)
