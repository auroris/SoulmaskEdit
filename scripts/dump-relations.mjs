#!/usr/bin/env node
/**
 * Service script: build a wsedit Relations index against a real world.db
 * and dump high-level stats + a few sample queries.
 *
 *   node scripts/dump-relations.mjs <path-to-world.db>
 *
 * Reads every actor_table row, decodes actor_data through wscodec, feeds
 * the decoded blob into a Relations index, and reports:
 *   - decode stats (decoded / skipped / failed)
 *   - relations stats (rows, rowsWithSelfUid, distinctGuids, totalRefs)
 *   - per-player: identity GUID + number of incoming references
 *   - sample npc/building: outbound refs (resolved or unresolved)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { UnrealBlob } from 'wscodec';
import { classify }   from '../src/classify.mjs';
import { Relations }  from '../src/relations.mjs';

const _lz4 = await import('lz4-wasm-nodejs');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || '../world.db';
if (!fs.existsSync(dbPath)) {
  console.error(`ERROR: database file not found: ${path.resolve(dbPath)}`);
  console.error('Usage: node scripts/dump-relations.mjs <path-to-world.db>');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare(`
  SELECT actor_serial, actor_name, actor_script, actor_transf, actor_data
  FROM actor_table
`).all();

console.log(`Source: ${dbPath}`);
console.log(`Rows:   ${rows.length}`);
console.log('');

// Suppress wscodec's warn-and-capture chatter — we don't need it here.
const origWarn = console.warn;
console.warn = () => {};

// Phase 1: classify every row and build name → serial lookup.
const kindBySerial = new Map();
const serialByName = new Map();
for (const row of rows) {
  const r = classify(row);
  kindBySerial.set(row.actor_serial, r.kind);
  if (row.actor_name) serialByName.set(row.actor_name, row.actor_serial);
}

// Phase 2: decode + ingest into Relations.
const rel = new Relations({
  kindLookup:      (serial) => kindBySerial.get(serial) ?? null,
  actorNameLookup: (name)   => serialByName.get(name)   ?? null,
});

let decoded = 0, skipped = 0, failed = 0;
for (const row of rows) {
  const u8 = row.actor_data;
  if (!u8 || u8.length < 8) { skipped++; continue; }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x00000002) { skipped++; continue; }
  let blob;
  try {
    const inner = _lz4.decompress(u8.subarray(4));
    blob = UnrealBlob.fromBytes(inner);
  } catch {
    failed++;
    continue;
  }
  rel.addRow(row.actor_serial, kindBySerial.get(row.actor_serial) || null, blob);
  decoded++;
}

console.warn = origWarn;

console.log('Decode stats:');
console.log(`  decoded ${decoded}   skipped ${skipped}   failed ${failed}`);
console.log('');

const s = rel.stats();
console.log('Relations stats:');
console.log(`  rows with refs       ${s.rows}`);
console.log(`  rows with identity   ${s.rowsWithSelfUid}`);
console.log(`  distinct GUIDs       ${s.distinctGuids}`);
console.log(`  total ref entries    ${s.totalRefs}`);
console.log('');

// Players: identity + incoming reference count.
const players = rows.filter(r => kindBySerial.get(r.actor_serial) === 'player');
console.log(`Players (${players.length}):`);
for (const p of players) {
  const id = rel.selfUidOf(p.actor_serial);
  const refCount = id ? rel.referrersOf(id).length : 0;
  const objRefCount = rel.referrersByActorName(p.actor_name).length;
  console.log(`  #${p.actor_serial} ${p.actor_name}`);
  console.log(`     ZhuRenGuid: ${id ?? '(missing)'}`);
  console.log(`     incoming GUID refs: ${refCount}     incoming ObjectRef refs: ${objRefCount}`);
}
console.log('');

// Sample npc + building outbound refs.
function sampleOutbound(kind, n) {
  const samples = rows.filter(r => kindBySerial.get(r.actor_serial) === kind).slice(0, n);
  console.log(`Sample ${kind} outbound (first ${n}):`);
  for (const r of samples) {
    const guidOut = rel.outboundFrom(r.actor_serial);
    const objOut  = rel.outboundObjRefsFrom(r.actor_serial);
    const guidHits = guidOut.filter(o => o.targetSerial != null).length;
    const objHits  = objOut.filter(o => o.targetSerial != null).length;
    console.log(`  #${r.actor_serial}  ${r.actor_name || '(no name)'}`);
    console.log(`     guid outbound: ${guidOut.length} (${guidHits} resolved)   objref outbound: ${objOut.length} (${objHits} resolved)`);
    for (const o of guidOut.slice(0, 3)) {
      console.log(`       guid  ${o.path}  →  ${o.targetSerial == null ? '(unresolved)' : '#' + o.targetSerial}`);
    }
    for (const o of objOut.slice(0, 3)) {
      console.log(`       obj   ${o.path}  →  ${o.targetSerial == null ? '(unresolved)' : '#' + o.targetSerial}`);
    }
  }
  console.log('');
}
sampleOutbound('npc', 3);
sampleOutbound('building', 3);
sampleOutbound('inventory', 3);

db.close();
