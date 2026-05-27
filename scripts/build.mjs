#!/usr/bin/env node
/**
 * Bundle the src/ ES modules into dist/ for non-bundler consumers.
 *
 *   dist/wsedit.mjs        bundled ESM - <script type="module"> / ESM CDN
 *   dist/wsedit.global.js  IIFE global - classic <script> (window.wsedit)
 *   dist/wsedit.cjs        bundled CJS - require()
 *
 * Bundler users import the src/ ESM directly (see package.json "exports"),
 * which tree-shakes; these bundles exist for everyone else. Run via
 * `npm run build`; also runs automatically before `npm publish`.
 *
 * wscodec is bundled in. The browser global build will expose `window.wsedit`
 * regardless of whether the host page also loads wscodec's own bundle.
 */
import * as esbuild from 'esbuild';

const bundles = [
  { entry: 'src/wsedit.mjs', base: 'wsedit', global: 'wsedit' },
];

const formats = [
  { format: 'esm',  ext: 'mjs',       platform: 'browser', minify: true  },
  { format: 'iife', ext: 'global.js', platform: 'browser', minify: true  },
  { format: 'cjs',  ext: 'cjs',       platform: 'node',    minify: false },
];

for (const b of bundles) {
  for (const f of formats) {
    const outfile = `dist/${b.base}.${f.ext}`;
    await esbuild.build({
      entryPoints: [b.entry],
      bundle: true,
      format: f.format,
      platform: f.platform,
      minify: f.minify,
      globalName: f.format === 'iife' ? b.global : undefined,
      target: ['es2020'],
      sourcemap: true,
      outfile,
    });
    console.log(`  ${outfile}`);
  }
}
console.log('build complete');
