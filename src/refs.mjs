/**
 * collectRefs(blob) — walk a decoded UnrealBlob and pull out every
 * cross-row reference candidate: GUIDs (Soulmask's primary identity /
 * reference key) and actor-instance ObjectRef paths (the secondary
 * Soulmask convention used by HBindBGCompActor and friends).
 *
 * Output:
 *   {
 *     guids:   [{ path, guid }],            // canonical 8-4-4-4-12 hex
 *     objRefs: [{ path, targetPath }],      // ObjectRef whose target is
 *                                           // an actor instance
 *   }
 *
 * `path` is the property path inside the blob where the reference was
 * found, e.g. `'MapHoldJianZhuList[419].value.JianZhuIndicator.JianZhuUid'`.
 * The path string is what `relations.mjs` uses to distinguish identity
 * (the row's own SelfUid / ZhuRenGuid) from outbound references.
 *
 * `collectGuids(blob)` and `collectObjRefs(blob)` are convenience wrappers
 * that drop one side of the output.
 *
 * Zero-GUID filtering: `00000000-0000-0000-0000-000000000000` is the
 * "unset" sentinel and would otherwise dominate the cross-reference index
 * with thousands of meaningless matches. It's dropped at walk time.
 *
 * ObjectRef class-vs-instance filtering: class-blueprint refs end with
 * `_C` (no trailing decimal); actor-instance refs end with `_C_<digits>`.
 * Only the latter resolve to anything in actor_table, so class refs are
 * dropped at walk time.
 */

import { UnrealBlob, FName, FGuid, StructValue, ObjectRef, SoftObjectRef,
         ArrayProperty, SetProperty, MapProperty } from 'wscodec';

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const ACTOR_INSTANCE_RE = /_C_\d+$/;

/**
 * Walk `blob` and return both reference kinds in one pass.
 *
 * @param {UnrealBlob | null | undefined} blob
 * @returns {{ guids: Array<{ path: string, guid: string }>, objRefs: Array<{ path: string, targetPath: string }> }}
 */
export function collectRefs(blob) {
  const sinks = { guids: [], objRefs: [] };
  if (blob && blob instanceof UnrealBlob) {
    walkProps(blob.properties, '', sinks);
  }
  return sinks;
}

/**
 * Walk `blob` and return only GUID references.
 *
 * @param {UnrealBlob | null | undefined} blob
 * @returns {Array<{ path: string, guid: string }>}
 */
export function collectGuids(blob) {
  const sinks = { guids: [], objRefs: null };
  if (blob && blob instanceof UnrealBlob) {
    walkProps(blob.properties, '', sinks);
  }
  return sinks.guids;
}

/**
 * Walk `blob` and return only actor-instance ObjectRef paths.
 *
 * @param {UnrealBlob | null | undefined} blob
 * @returns {Array<{ path: string, targetPath: string }>}
 */
export function collectObjRefs(blob) {
  const sinks = { guids: null, objRefs: [] };
  if (blob && blob instanceof UnrealBlob) {
    walkProps(blob.properties, '', sinks);
  }
  return sinks.objRefs;
}

function walkProps(properties, prefix, sinks) {
  if (!Array.isArray(properties)) return;
  for (const p of properties) {
    if (!p || typeof p.name !== 'string') continue;
    const childPath = prefix ? `${prefix}.${p.name}` : p.name;
    walkProperty(p, childPath, sinks);
  }
}

function walkProperty(p, path, sinks) {
  // Array / Set: walk elements with indexed paths.
  if (p instanceof ArrayProperty || p instanceof SetProperty) {
    if (Array.isArray(p.elements)) {
      for (let i = 0; i < p.elements.length; i++) {
        walkValue(p.elements[i], `${path}[${i}]`, sinks);
      }
    }
    return;
  }
  // Map: walk entries with .key / .value sub-paths.
  if (p instanceof MapProperty) {
    if (Array.isArray(p.entries)) {
      for (let i = 0; i < p.entries.length; i++) {
        walkValue(p.entries[i].key,   `${path}[${i}].key`,   sinks);
        walkValue(p.entries[i].value, `${path}[${i}].value`, sinks);
      }
    }
    return;
  }
  // Single-value leaf: dispatch on the value shape.
  walkValue(p.value, path, sinks);
}

function walkValue(value, path, sinks) {
  if (value == null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return;
  if (value instanceof FName) return;
  if (value instanceof FGuid) {
    // Bare FGuid (e.g. as a Map<Struct,_> raw-key form) — emit if non-zero.
    if (sinks.guids) {
      const g = String(value.value);
      if (g.toUpperCase() !== ZERO_GUID) sinks.guids.push({ path, guid: g });
    }
    return;
  }
  if (value instanceof ObjectRef) {
    if (sinks.objRefs && typeof value.path === 'string' && ACTOR_INSTANCE_RE.test(value.path)) {
      sinks.objRefs.push({ path, targetPath: value.path });
    }
    // ObjectRef may carry an embedded property stream — walk into it.
    if (value.embedded && Array.isArray(value.embedded.properties)) {
      walkProps(value.embedded.properties, path, sinks);
    }
    return;
  }
  if (value instanceof SoftObjectRef) {
    // SoftObjectRefs are asset paths, not actor-instance pointers. Skip.
    return;
  }
  if (value instanceof StructValue) {
    if (value.structName === 'Guid') {
      // Binary form holds an FGuid instance; propStream form is unusual
      // for Guid but defensively recurse if encountered.
      if (value.form === 'binary' && value.binaryValue instanceof FGuid) {
        if (sinks.guids) {
          const g = String(value.binaryValue.value);
          if (g.toUpperCase() !== ZERO_GUID) sinks.guids.push({ path, guid: g });
        }
        return;
      }
    }
    if (value.form === 'propStream' && value.stream && Array.isArray(value.stream.properties)) {
      walkProps(value.stream.properties, path, sinks);
    }
    return;
  }
  // Unknown shape — leaf. Nothing to recurse into.
}
