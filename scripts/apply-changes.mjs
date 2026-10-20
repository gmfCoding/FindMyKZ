#!/usr/bin/env node
/**
 * Applies an exported FindMyKZ changes file to public/data/maps.json, then
 * rebuilds public/data/maps.zip.
 *
 * Usage:
 *   npm run apply:changes -- path/to/maps_changes.json
 *   node scripts/apply-changes.mjs maps_changes.json --dry-run
 *   node scripts/apply-changes.mjs maps_changes.json --no-pack
 *
 * Only fields present in the exported delta are touched. Untouched maps and
 * properties are preserved exactly.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapsPath = join(root, 'public', 'data', 'maps.json');
const packScript = join(root, 'scripts', 'pack-data.mjs');

const args = process.argv.slice(2);
const fileArg = args.find((arg) => !arg.startsWith('-'));
const dryRun = args.includes('--dry-run');
const noPack = args.includes('--no-pack');

if (!fileArg) {
  console.error('Usage: npm run apply:changes -- path/to/maps_changes.json [--dry-run] [--no-pack]');
  process.exit(1);
}

const PATCHABLE_FIELDS = [
  'id',
  'name',
  'global',
  'materials',
  'props',
  'topTime',
  'vnlTopTime',
  'tpTier',
  'proTier',
  'headbangers',
  'ladderAmount',
  'ladderTypes',
  'bhop',
  'bhopColour',
  'multi',
  'multiColour',
  'prekeep',
  'prekeepColour',
  'surfAmounts',
  'surfMaterials',
  'port',
  'basedOn',
  'weather',
  'scenery',
  'timeOfDay',
  'tech',
  'ljRoom',
  'ljBlock',
  'ladderRoom',
  'path',
  'special',
  'bonus',
  'catalogued',
  'mappers',
  'description',
  'thumbnail',
  'workshopId',
  'cs2kzId',
  'notes',
];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cleanFields(source, extra = []) {
  const result = {};
  for (const field of [...PATCHABLE_FIELDS, ...extra]) {
    if (hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

const changesPath = resolve(process.cwd(), fileArg);
const changes = JSON.parse(await readFile(changesPath, 'utf8'));

if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
  throw new Error('Changes file must be a JSON object.');
}
if (changes.maps && !changes.changes) {
  throw new Error(
    'This looks like a full Export All file. apply-changes expects a maps_changes.json delta export.',
  );
}
if (changes.format !== 'findmykz-changes') {
  throw new Error(`Unsupported changes file (expected format "findmykz-changes").`);
}

const dataset = JSON.parse(await readFile(mapsPath, 'utf8'));
if (!Array.isArray(dataset.maps)) throw new Error('public/data/maps.json has no maps array.');

if (
  typeof changes.baseUpdatedAt === 'string' &&
  changes.baseUpdatedAt &&
  changes.baseUpdatedAt !== dataset.updatedAt
) {
  console.warn(
    `Warning: changes were exported against a different dataset version\n` +
      `  changes base: ${changes.baseUpdatedAt}\n` +
      `  local base:   ${dataset.updatedAt}\n` +
      `  Applying by map id anyway.`,
  );
}

const mapById = new Map(dataset.maps.map((map) => [map.id, map]));
const applied = [];
const missing = [];
const added = [];
const skippedAdded = [];
const deleted = [];
const now = new Date().toISOString();

for (const [id, rawPatch] of Object.entries(changes.changes ?? {})) {
  const map = mapById.get(id);
  if (!map) {
    missing.push(id);
    continue;
  }
  const patch = cleanFields(rawPatch, ['updatedAt']);
  if (Object.keys(patch).length === 0) continue;
  Object.assign(map, patch);
  if (!patch.updatedAt) map.updatedAt = now;
  applied.push(id);
}

for (const [id, rawRecord] of Object.entries(changes.added ?? {})) {
  if (mapById.has(id)) {
    skippedAdded.push(id);
    continue;
  }
  if (!rawRecord || typeof rawRecord !== 'object') continue;
  const record = cleanFields(rawRecord, ['updatedAt']);
  record.id = typeof record.id === 'string' && record.id ? record.id : id;
  record.name = typeof record.name === 'string' && record.name.trim() ? record.name : id;
  record.updatedAt = record.updatedAt || now;
  dataset.maps.push(record);
  mapById.set(record.id, record);
  added.push(record.id);
}

for (const id of Array.isArray(changes.deleted) ? changes.deleted : []) {
  const index = dataset.maps.findIndex((map) => map.id === id);
  if (index === -1) continue;
  dataset.maps.splice(index, 1);
  mapById.delete(id);
  deleted.push(id);
}

dataset.version = Math.max(Number(dataset.version) || 1, 4);
dataset.updatedAt = now;
dataset.lastChangedAt = now;

console.log(`Changes file: ${changesPath}`);
console.log(`  patched maps:  ${applied.length}`);
console.log(`  added maps:    ${added.length}`);
console.log(`  deleted maps:  ${deleted.length}`);
if (missing.length) console.log(`  missing maps:  ${missing.length} (skipped: ${missing.join(', ')})`);
if (skippedAdded.length) console.log(`  already exists (additions skipped): ${skippedAdded.join(', ')}`);

if (dryRun) {
  console.log('\nDry run: nothing written.');
  process.exit(0);
}

await writeFile(mapsPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`\nWrote ${mapsPath}`);

if (!noPack) {
  console.log('Rebuilding public/data/maps.zip…');
  execFileSync(process.execPath, [packScript], { stdio: 'inherit' });
} else {
  console.log('Skipped maps.zip rebuild (--no-pack).');
}

console.log('\nDone. Run `npm run package` to refresh dist/ and findmykz-static.zip.');
