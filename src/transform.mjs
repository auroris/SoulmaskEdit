/**
 * Transform helpers for actor_table.actor_transf strings.
 *
 * The actor_transf column stores a flat ASCII triple:
 *
 *   "x,y,z|rx,ry,rz|sx,sy,sz"
 *
 * Unreal serializes FRotator as (pitch, yaw, roll), so the rotation triple
 * is (pitch, yaw, roll) — yaw is index 1. Position is in Unreal units (cm);
 * distanceMeters divides by 100 on output.
 *
 * Pure, no dependencies. Used by classify.mjs (for generic-row summaries)
 * and exposed for direct caller use.
 */

/**
 * 8-way compass labels indexed by yaw octant.
 *
 * World-axis-to-compass convention: +X = East, +Y = North, positive yaw
 * rotates from +X toward +Y (counter-clockwise on the map). If a verified
 * actor disagrees with this orientation, flip the sign of yaw inside
 * `bearingFromTransform` — this array is the single source of truth.
 */
export const COMPASS_8 = Object.freeze(['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE']);

/**
 * Parse an actor_transf string into structured form.
 * Returns null on any malformed component (wrong segment count, non-finite
 * numbers, missing triples).
 *
 * @param {string | null | undefined} transf
 * @returns {{ pos: [number, number, number], rot: [number, number, number], scale: [number, number, number] } | null}
 */
export function parseTransform(transf) {
  if (!transf) return null;
  const parts = transf.split('|');
  if (parts.length !== 3) return null;
  const triples = parts.map(p => p.split(',').map(Number));
  if (triples.some(tr => tr.length !== 3 || tr.some(n => !isFinite(n)))) return null;
  return { pos: triples[0], rot: triples[1], scale: triples[2] };
}

/**
 * Yaw → 8-way compass code ('N','NE',...). Returns null on malformed input.
 *
 * @param {{ rot: number[] } | null} tx
 * @returns {string | null}
 */
export function bearingFromTransform(tx) {
  if (!tx || !Array.isArray(tx.rot) || tx.rot.length !== 3) return null;
  let yaw = tx.rot[1];
  if (!isFinite(yaw)) return null;
  yaw = ((yaw % 360) + 360) % 360;
  return COMPASS_8[Math.round(yaw / 45) % 8];
}

/**
 * 3D Euclidean distance between a parsed transform and an [x,y,z] anchor,
 * converted from Unreal units (cm) to meters. null on malformed input.
 *
 * @param {{ pos: number[] } | null} tx
 * @param {[number, number, number] | number[]} anchorPos
 * @returns {number | null}
 */
export function distanceMeters(tx, anchorPos) {
  if (!tx || !Array.isArray(tx.pos) || tx.pos.length !== 3) return null;
  if (!Array.isArray(anchorPos) || anchorPos.length !== 3) return null;
  const dx = tx.pos[0] - anchorPos[0];
  const dy = tx.pos[1] - anchorPos[1];
  const dz = tx.pos[2] - anchorPos[2];
  return Math.hypot(dx, dy, dz) / 100;
}
