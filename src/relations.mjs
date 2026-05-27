/**
 * Relations — cross-row GUID + ObjectRef reverse index.
 *
 * Soulmask uses two parallel reference systems between actor_table rows:
 *
 *   1. **FGuid identity**. Each row owns an identity GUID exposed inside
 *      its decoded blob (the property path is `'SelfUid'` for most kinds
 *      but `'ZhuRenGuid'` for HPlayerState rows — the same property name
 *      is a *reference* on NPC rows). Other rows reference the owner by
 *      embedding that GUID at named property paths. `referrersOf(guid)`
 *      gives "who points AT this guid?", `rowBySelfUid(guid)` gives the
 *      identity holder.
 *
 *   2. **ObjectRef path**. Some refs (notably `HBindBGCompActor`, used to
 *      link an NPC to its inventory storage row) carry the target's full
 *      Unreal path. The target's `actor_name` column in SQL holds that
 *      same path verbatim, so resolving an ObjectRef is a name → serial
 *      lookup against actor_table.
 *
 * This module ports SoulmaskDB's `references-service.mjs` to the wsedit
 * layer, stripped of the worker-batch lifecycle it carried (we're called
 * synchronously with already-decoded blobs). The query surface is the
 * same.
 *
 * Lifecycle:
 *   const rel = new Relations({ kindLookup, actorNameLookup });
 *   for (const row of rows) rel.addRow(row.actor_serial, kind, blob);
 *   ...
 *   rel.referrersOfRow(playerSerial);     // → [{ serial, path }]
 *   rel.outboundFrom(buildingSerial);     // → [{ guid, path, targetSerial }]
 *   rel.refreshRow(serial, blob);         // re-index after an edit
 *   rel.dropRow(serial);                  // after a delete
 *   rel.clear();                          // wipe everything
 *
 * `kindLookup(serial) → string|null` decides which property path is
 * identity (per IDENTITY_PATH_BY_KIND below). `actorNameLookup(name) →
 * serial|null` resolves ObjectRef targets to their row's serial. Both
 * are optional — when absent, identity falls back to `'SelfUid'` and
 * ObjectRef targets stay unresolved (targetSerial=null).
 *
 * The index is fully synchronous and re-entrant safe at the call level
 * (no internal `await`s). `addRow` is idempotent — calling it twice for
 * the same serial just re-indexes that row.
 */

import { collectRefs } from './refs.mjs';

/**
 * Identity-property convention by classified row kind. Default is
 * 'SelfUid' — most rows put their identity at that path. Players are
 * special: `ZhuRenGuid` on an HPlayerState row carries the player's OWN
 * identity, but the same property name on an NPC row is a *reference* to
 * its owning player. Distinguishing the two is the only reason we need a
 * kindLookup here.
 *
 * Add entries when more identity-path conventions are discovered (guild
 * rows, system rows, etc.).
 */
export const IDENTITY_PATH_BY_KIND = Object.freeze({
  player: 'ZhuRenGuid',
});
export const DEFAULT_IDENTITY_PATH = 'SelfUid';

/**
 * Path patterns identifying sub-entity GUIDs that live inline inside a
 * parent row's blob — e.g. deck pieces of a ship live under
 * `MapHoldJianZhuList[N].value.JianZhuIndicator.JianZhuUid` on the ship's
 * row, with no standalone actor_table row of their own. Without this
 * list those GUIDs would flow into `_outboundByRow` as outbound
 * references (each rendering as "target not in loaded set") and pollute
 * `referrersOf` results.
 *
 * Matching path entries are:
 *   - excluded from the row's outbound list (they aren't references TO
 *     something else; they ARE this row's sub-identities)
 *   - registered in `_rowBySelfUid` so OTHER rows that reference one of
 *     these sub-entity GUIDs resolve back to this parent row
 *   - excluded from `referrersOf` (a sub-identity isn't a referrer)
 *   - NOT placed in `_selfUidByRow` (that holds the primary identity)
 */
export const NESTED_IDENTITY_PATTERNS = Object.freeze([
  /(?:^|\.)MapHoldJianZhuList\[\d+\]\.value\.JianZhuIndicator\.JianZhuUid$/,
]);

function isNestedIdentityPath(path) {
  for (const re of NESTED_IDENTITY_PATTERNS) {
    if (re.test(path)) return true;
  }
  return false;
}

export class Relations {
  /**
   * @param {object} [options]
   * @param {(serial: number) => (string | null)} [options.kindLookup]
   *   Resolve serial → classify().kind. When absent, identity falls
   *   back to DEFAULT_IDENTITY_PATH for every row.
   * @param {(actorName: string) => (number | null)} [options.actorNameLookup]
   *   Resolve an ObjectRef's targetPath (= target row's actor_name) to
   *   its serial. When absent, `outboundObjRefsFrom` returns entries
   *   with `targetSerial: null` — the index still tracks the path.
   */
  constructor({ kindLookup = null, actorNameLookup = null } = {}) {
    this._kindLookup       = kindLookup;
    this._actorNameLookup  = actorNameLookup;

    this._guidIndex             = new Map(); // guid → [{serial, path, isIdentity, isNestedIdentity}]
    this._outboundByRow         = new Map(); // serial → [{guid, path}]
    this._selfUidByRow          = new Map(); // serial → guid
    this._rowBySelfUid          = new Map(); // guid → serial
    this._nestedIdentitiesByRow = new Map(); // serial → [{guid, path}]
    this._outboundObjRefsByRow  = new Map(); // serial → [{path, targetPath}]
    this._objRefReferrersByName = new Map(); // actorName → [{serial, path}]
    this._totalRefs = 0;
  }

  /** Replace the kind lookup. Existing rows are NOT re-indexed; call refreshRow if needed. */
  setKindLookup(fn)      { this._kindLookup      = fn || null; }
  /** Replace the actor-name lookup. ObjectRef queries pick up the new resolution on next call. */
  setActorNameLookup(fn) { this._actorNameLookup = fn || null; }

  // ---- lifecycle --------------------------------------------------------

  /**
   * Add (or re-index) a row. `kind` is the row's classify().kind — used
   * to pick the identity path. `blob` is a decoded {@link UnrealBlob}
   * (or anything `collectRefs` accepts). Pass `blob = null` to drop the
   * row's references without removing it; pass `blob` empty for a
   * "no references" row.
   *
   * Idempotent: calling addRow twice for the same serial replaces the
   * prior entries.
   *
   * @param {number} serial
   * @param {string | null} kind
   * @param {import('wscodec').UnrealBlob | null | undefined} blob
   */
  addRow(serial, kind, blob) {
    this._removeRow(serial);
    if (!blob) return;
    const refs = collectRefs(blob);
    this._absorb(serial, kind, refs);
  }

  /**
   * Re-index a single row after an edit. Equivalent to addRow with the
   * row's current kind (which addRow already takes as a parameter); kept
   * as a separate method for parity with the SoulmaskDB surface.
   *
   * @param {number} serial
   * @param {string | null} kind
   * @param {import('wscodec').UnrealBlob | null | undefined} blob
   */
  refreshRow(serial, kind, blob) {
    this.addRow(serial, kind, blob);
  }

  /**
   * Drop one row's entries. Used after a delete.
   *
   * @param {number} serial
   */
  dropRow(serial) {
    this._removeRow(serial);
  }

  /** Reset all indexed state. */
  clear() {
    this._guidIndex.clear();
    this._outboundByRow.clear();
    this._selfUidByRow.clear();
    this._rowBySelfUid.clear();
    this._nestedIdentitiesByRow.clear();
    this._outboundObjRefsByRow.clear();
    this._objRefReferrersByName.clear();
    this._totalRefs = 0;
  }

  // ---- queries ----------------------------------------------------------

  /**
   * Every row that mentions `guid` at a non-identity property — "who
   * points AT this guid?". Identity and nested-identity entries are
   * filtered out at query time.
   *
   * @param {string} guid
   * @returns {Array<{ serial: number, path: string }>}
   */
  referrersOf(guid) {
    const bucket = this._guidIndex.get(guid);
    if (!bucket) return [];
    const out = [];
    for (const entry of bucket) {
      if (entry.isIdentity || entry.isNestedIdentity) continue;
      out.push({ serial: entry.serial, path: entry.path });
    }
    return out;
  }

  /**
   * Convenience: who points at the row whose identity-GUID we look up
   * by `serial`. Returns `[]` if the row has no identity (some metadata
   * rows don't).
   *
   * @param {number} serial
   * @returns {Array<{ serial: number, path: string }>}
   */
  referrersOfRow(serial) {
    const guid = this._selfUidByRow.get(serial);
    if (!guid) return [];
    return this.referrersOf(guid);
  }

  /** Row's identity guid (under its kind's identity path), or null. */
  selfUidOf(serial) {
    return this._selfUidByRow.get(serial) ?? null;
  }

  /** Reverse: which row claims this guid as its identity, or null. */
  rowBySelfUid(guid) {
    return this._rowBySelfUid.get(guid) ?? null;
  }

  /**
   * Every GUID this row references (identity excluded), with the
   * resolved target serial when one is loaded.
   *
   * @param {number} serial
   * @returns {Array<{ guid: string, path: string, targetSerial: number | null }>}
   */
  outboundFrom(serial) {
    const outbound = this._outboundByRow.get(serial);
    if (!outbound) return [];
    const out = new Array(outbound.length);
    for (let i = 0; i < outbound.length; i++) {
      const o = outbound[i];
      out[i] = {
        guid: o.guid,
        path: o.path,
        targetSerial: this._rowBySelfUid.get(o.guid) ?? null,
      };
    }
    return out;
  }

  /**
   * Every actor-instance ObjectRef this row points at, with the target
   * resolved to a serial via `actorNameLookup`.
   *
   * @param {number} serial
   * @returns {Array<{ path: string, targetPath: string, targetSerial: number | null }>}
   */
  outboundObjRefsFrom(serial) {
    const outbound = this._outboundObjRefsByRow.get(serial);
    if (!outbound) return [];
    const out = new Array(outbound.length);
    for (let i = 0; i < outbound.length; i++) {
      const o = outbound[i];
      out[i] = {
        path: o.path,
        targetPath: o.targetPath,
        targetSerial: this._actorNameLookup ? (this._actorNameLookup(o.targetPath) ?? null) : null,
      };
    }
    return out;
  }

  /**
   * Reverse lookup: which rows reference an actor whose `actor_name`
   * equals `actorName`? Used by the compound-object logic to find the
   * parent of an inventory row whose owner points at it via
   * HBindBGCompActor or similar.
   *
   * @param {string} actorName
   * @returns {Array<{ serial: number, path: string }>}
   */
  referrersByActorName(actorName) {
    const bucket = this._objRefReferrersByName.get(actorName);
    return bucket ? bucket.slice() : [];
  }

  /** @returns {{ rows: number, rowsWithSelfUid: number, distinctGuids: number, totalRefs: number }} */
  stats() {
    return {
      rows:            this._outboundByRow.size,
      rowsWithSelfUid: this._selfUidByRow.size,
      distinctGuids:   this._guidIndex.size,
      totalRefs:       this._totalRefs,
    };
  }

  // ---- internals --------------------------------------------------------

  _identityPathFor(kind) {
    if (kind && Object.prototype.hasOwnProperty.call(IDENTITY_PATH_BY_KIND, kind)) {
      return IDENTITY_PATH_BY_KIND[kind];
    }
    return DEFAULT_IDENTITY_PATH;
  }

  _absorb(serial, kind, refs) {
    if (!refs) return;
    const identityPath = this._identityPathFor(kind || (this._kindLookup ? this._kindLookup(serial) : null));

    // GUIDs.
    let outbound = null;
    let nested   = null;
    if (Array.isArray(refs.guids)) {
      for (const { path, guid } of refs.guids) {
        if (!guid) continue;
        const isIdentity       = path === identityPath;
        const isNestedIdentity = !isIdentity && isNestedIdentityPath(path);

        let bucket = this._guidIndex.get(guid);
        if (!bucket) { bucket = []; this._guidIndex.set(guid, bucket); }
        bucket.push({ serial, path, isIdentity, isNestedIdentity });
        this._totalRefs++;

        if (isIdentity) {
          this._selfUidByRow.set(serial, guid);
          // Last writer wins on collision; identity GUIDs are supposed
          // to be unique, but if two rows claim the same one we let the
          // later writer take the rowBySelfUid mapping.
          this._rowBySelfUid.set(guid, serial);
        } else if (isNestedIdentity) {
          if (!nested) nested = [];
          nested.push({ guid, path });
          // Don't overwrite an existing primary-identity mapping — if
          // another row already claims this guid as PRIMARY, that wins.
          if (!this._rowBySelfUid.has(guid)) {
            this._rowBySelfUid.set(guid, serial);
          }
        } else {
          if (!outbound) outbound = [];
          outbound.push({ guid, path });
        }
      }
    }

    // ObjectRefs.
    let outboundObjRef = null;
    if (Array.isArray(refs.objRefs)) {
      for (const { path, targetPath } of refs.objRefs) {
        if (!path || !targetPath) continue;
        if (!outboundObjRef) outboundObjRef = [];
        outboundObjRef.push({ path, targetPath });
        let bucket = this._objRefReferrersByName.get(targetPath);
        if (!bucket) { bucket = []; this._objRefReferrersByName.set(targetPath, bucket); }
        bucket.push({ serial, path });
        this._totalRefs++;
      }
    }

    if (outbound)       this._outboundByRow.set(serial, outbound);
    if (nested)         this._nestedIdentitiesByRow.set(serial, nested);
    if (outboundObjRef) this._outboundObjRefsByRow.set(serial, outboundObjRef);
  }

  _removeRow(serial) {
    const outbound = this._outboundByRow.get(serial);
    if (outbound) {
      for (const { guid } of outbound) this._dropFromBucket(guid, serial);
      this._outboundByRow.delete(serial);
    }
    const nested = this._nestedIdentitiesByRow.get(serial);
    if (nested) {
      for (const { guid } of nested) {
        this._dropFromBucket(guid, serial);
        if (this._rowBySelfUid.get(guid) === serial) {
          this._rowBySelfUid.delete(guid);
        }
      }
      this._nestedIdentitiesByRow.delete(serial);
    }
    const selfUid = this._selfUidByRow.get(serial);
    if (selfUid != null) {
      this._dropFromBucket(selfUid, serial);
      this._selfUidByRow.delete(serial);
      if (this._rowBySelfUid.get(selfUid) === serial) {
        this._rowBySelfUid.delete(selfUid);
      }
    }
    const objRefs = this._outboundObjRefsByRow.get(serial);
    if (objRefs) {
      for (const { targetPath } of objRefs) {
        const bucket = this._objRefReferrersByName.get(targetPath);
        if (!bucket) continue;
        for (let i = bucket.length - 1; i >= 0; i--) {
          if (bucket[i].serial === serial) {
            bucket.splice(i, 1);
            this._totalRefs--;
          }
        }
        if (bucket.length === 0) this._objRefReferrersByName.delete(targetPath);
      }
      this._outboundObjRefsByRow.delete(serial);
    }
  }

  _dropFromBucket(guid, serial) {
    const bucket = this._guidIndex.get(guid);
    if (!bucket) return;
    let removed = 0;
    for (let i = bucket.length - 1; i >= 0; i--) {
      if (bucket[i].serial === serial) {
        bucket.splice(i, 1);
        removed++;
      }
    }
    this._totalRefs -= removed;
    if (bucket.length === 0) this._guidIndex.delete(guid);
  }
}
