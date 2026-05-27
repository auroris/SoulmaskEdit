#!/usr/bin/env node
/**
 * Service script: classify every actor_table row in a world.db and print
 * a kind-count summary plus a few samples per kind.
 *
 *   node scripts/dump-classify.mjs <path-to-world.db>
 *
 * Useful as the first end-to-end exercise of wsedit against a real save:
 * confirms the rule table covers the row shapes you actually see, and
 * surfaces unclassified rows (kind='other') for follow-up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { classify } from '../src/classify.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || '../world.db';
if (!fs.existsSync(dbPath)) {
  console.error(`ERROR: database file not found: ${path.resolve(dbPath)}`);
  console.error('Usage: node scripts/dump-classify.mjs <path-to-world.db>');
  process.exit(1);
}

const SAMPLES_PER_KIND = 5;

const db = new Database(dbPath, { readonly: true });

const rows = db.prepare(`
  SELECT actor_serial, actor_name, actor_script, actor_transf
  FROM actor_table
`).all();

console.log(`Source: ${dbPath}`);
console.log(`Rows:   ${rows.length}`);
console.log('');

const kindCounts = new Map();
const pairCounts = new Map();        // "kind/subKind" → count
const samples = new Map();           // pairKey → up to N samples
function pairKey(kind, subKind) { return subKind ? `${kind}/${subKind}` : kind; }

for (const row of rows) {
  const r = classify(row);
  kindCounts.set(r.kind, (kindCounts.get(r.kind) || 0) + 1);
  const key = pairKey(r.kind, r.subKind);
  pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  const bucket = samples.get(key) || [];
  if (bucket.length < SAMPLES_PER_KIND) {
    bucket.push({ serial: row.actor_serial, label: r.label, summary: r.summary });
    samples.set(key, bucket);
  }
}

const sortedKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);
const sortedPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);

console.log('Kind counts:');
for (const [kind, n] of sortedKinds) {
  console.log(`  ${kind.padEnd(12)} ${n}`);
}
console.log('');

console.log('Kind / subKind counts:');
for (const [key, n] of sortedPairs) {
  console.log(`  ${key.padEnd(28)} ${n}`);
}
console.log('');

console.log('Samples:');
for (const [key] of sortedPairs) {
  console.log(`  [${key}]`);
  for (const s of samples.get(key)) {
    const sum = s.summary.type === 'key'
      ? `key=${s.summary.key}`
      : `ident=${s.summary.ident}` +
        (s.summary.pos ? ` pos=[${s.summary.pos.map(n => Math.round(n)).join(',')}]` : '') +
        (s.summary.bearing ? ` bearing=${s.summary.bearing}` : '');
    console.log(`    #${s.serial}  ${s.label || '(no label)'}  ${sum}`);
  }
}

db.close();
