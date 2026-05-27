[**wsedit**](../README.md)

***

[wsedit](../README.md) / aggregateScripts

# Function: aggregateScripts()

> **aggregateScripts**(`rows`): `object`[]

Defined in: classify.mjs:298

Group classified rows by actor_script. Returns one record per distinct
script with { script, count, kind, subKind, sampleLabel }. Since classify
is deterministic per script, kind/subKind are uniform within a script
and the first sample is representative.

Expects rows with `_kind`, `_subKind`, and `_label` set (the
in-place annotation pattern), so this helper can be applied
post-classification without recomputing.

## Parameters

### rows

`object`[]

## Returns

`object`[]
