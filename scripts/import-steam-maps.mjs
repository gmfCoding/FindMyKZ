#!/usr/bin/env node
/**
 * Adds every Workshop map in public/data/maps_steam.json that is not catalogued yet.
 *
 *   node scripts/import-steam-maps.mjs            write to the SQLite database and public/data/maps.json
 *   node scripts/import-steam-maps.mjs --dry-run  report what would be added, write nothing
 *
 * Only what Steam provides is stored (name, description, preview image, Workshop ID). Every
 * other property stays Unknown / empty and the map is flagged Uncatalogued. Maps whose Workshop
 * ID is already present are skipped, so the script is safe to re-run after `npm run steam:data`.
 * This is a baseline import like seeding: it writes no audit rows.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRecord } from '../public/js/data.js';
import { DB_PATH, closeDb, db, getMeta, setMeta, transaction } from '../server/db.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STEAM_JSON = join(ROOT, 'public', 'data', 'maps_steam.json');
const MAPS_JSON = join(ROOT, 'public', 'data', 'maps.json');
const DRY_RUN = process.argv.includes('--dry-run');

const steam = JSON.parse(readFileSync(STEAM_JSON, 'utf8'));
const dataset = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));

const dbRows = db.prepare('SELECT id, record FROM maps').all();
const knownIds = new Set([...dbRows.map((row) => row.id), ...dataset.maps.map((map) => map.id)]);
const knownWorkshopIds = new Set(
  [...dbRows.map((row) => JSON.parse(row.record).workshopId), ...dataset.maps.map((map) => map.workshopId)]
    .filter(Boolean)
    .map(String),
);

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const fresh = steam.maps.filter((map) => map.workshopId && !knownWorkshopIds.has(String(map.workshopId)));

// A slug is used as-is only when nothing else claims it; otherwise the Workshop ID disambiguates.
const slugCounts = new Map();
for (const map of fresh) {
  const slug = slugify(map.name) || 'map';
  slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
}

const stamp = new Date().toISOString();
const records = fresh.map((map) => {
  const slug = slugify(map.name) || 'map';
  const unique = slugCounts.get(slug) === 1 && !knownIds.has(slug);
  const id = unique ? slug : `${slug}-${map.workshopId}`;
  return {
    ...normalizeRecord({
      id,
      name: String(map.name).trim().slice(0, 100),
      description: typeof map.description === 'string' ? map.description.trim() : '',
      thumbnail: typeof map.previewUrl === 'string' && map.previewUrl.startsWith('https://') ? map.previewUrl : null,
      workshopId: String(map.workshopId),
      catalogued: 'Uncatalogued',
      notes: 'Added from the Steam Workshop list; only the Workshop metadata is recorded.',
      updatedAt: stamp,
    }),
    id,
  };
});

const clashes = records.filter((record) => knownIds.has(record.id));
if (clashes.length > 0 || new Set(records.map((record) => record.id)).size !== records.length) {
  throw new Error('Could not generate unique ids; refusing to write anything.');
}

console.log(`Steam list: ${steam.maps.length} maps, ${steam.maps.length - fresh.length} already catalogued.`);
console.log(`To add: ${records.length} (all Uncatalogued).`);

if (DRY_RUN || records.length === 0) {
  if (DRY_RUN) console.log('Dry run: nothing written.');
  closeDb();
  process.exit(0);
}

const insert = db.prepare(
  'INSERT INTO maps (id, record, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
);
transaction(() => {
  for (const record of records) insert.run(record.id, JSON.stringify(record), stamp, stamp);
  setMeta('steamImportedAt', stamp);
  setMeta('steamImportedCount', String(Number(getMeta('steamImportedCount') ?? 0) + records.length));
});

dataset.maps.push(...records);
dataset.updatedAt = stamp;
writeFileSync(MAPS_JSON, `${JSON.stringify(dataset, null, 2)}\n`);

console.log(`Added ${records.length} maps to ${DB_PATH} and public/data/maps.json.`);
console.log('Run `npm run pack` to rebuild maps.zip.');
closeDb();
