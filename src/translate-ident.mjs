/**
 * Romanized-Mandarin identifier decomposer.
 *
 * Soulmask blueprint class names are romanized-Mandarin compounds, e.g.
 * `BP_DongWu_Yu_C`. To produce a friendly display string the caller needs
 * to:
 *
 *   1. Strip Unreal's conventional decorations (`BP_` blueprint prefix,
 *      `H` WS-class marker, `_C` class suffix).
 *   2. Split on `_` / `.` into parts.
 *   3. Decompose each part token-by-token, since a part may itself be a
 *      PascalCase compound like "ZhiBeiGuanLiQi" — walk the longest
 *      gloss-prefix and recurse on the remainder.
 *
 * wsedit ships the *algorithm* (steps 1–3 above). The actual gloss data
 * (romanized token → display word in the active locale) lives in the host
 * UI — pass a `glossLookup(token) => string | null` function and the
 * decomposer will use it. If the lookup returns null/undefined for a
 * token, the raw token is preserved verbatim (the right default for new
 * game-introduced names).
 *
 * Browser-safe, no dependencies.
 */

/**
 * Decompose a single token, walking PascalCase boundaries to find the
 * longest prefix the glossLookup recognizes. Recurses on the remainder.
 * Tokens that the lookup doesn't recognize at any prefix length pass
 * through unchanged.
 *
 * @param {string} token
 * @param {(t: string) => (string | null | undefined)} glossLookup
 * @returns {string}
 */
export function decomposeIdent(token, glossLookup) {
  if (!token) return '';
  const v = glossLookup(token);
  if (v != null) return v;
  // Whole-token miss: walk from the end so the first PascalCase boundary
  // we accept is the longest gloss-recognized prefix.
  for (let i = token.length - 1; i > 0; i--) {
    if (!isPascalBoundary(token, i)) continue;
    const head = glossLookup(token.slice(0, i));
    if (head != null) {
      const rest = decomposeIdent(token.slice(i), glossLookup);
      return rest ? head + ' ' + rest : head;
    }
  }
  return token;
}

/**
 * Strip Unreal decorations and decompose each underscore/dot-separated part.
 * Joins parts with spaces.
 *
 * @param {string | null | undefined} ident
 * @param {(t: string) => (string | null | undefined)} glossLookup
 * @returns {string}
 */
export function translateIdent(ident, glossLookup) {
  if (!ident) return '';
  const cleaned = ident
    .replace(/^BP_/, '')
    .replace(/^H(?=[A-Z][a-z])/, '')
    .replace(/_C$/, '');
  return cleaned
    .split(/[_.]/)
    .filter(Boolean)
    .map(t => decomposeIdent(t, glossLookup))
    .join(' ');
}

function isPascalBoundary(s, i) {
  return /[a-z]/.test(s[i - 1]) && /[A-Z]/.test(s[i]);
}
