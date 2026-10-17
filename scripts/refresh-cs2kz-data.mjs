#!/usr/bin/env node
/**
 * Rebuilds public/data/maps.json from the live cs2kz.org API.
 *
 * Only values that cs2kz.org actually provides are written:
 *   - name, mappers, description, Workshop ID, cs2kz ID
 *   - global = Yes for approved maps
 *   - TP / Pro tier from the primary course in CLASSIC mode
 *     (Main if present, otherwise the first course listed by cs2kz)
 *   - thumbnail URL from Steam's public workshop API
 *
 * Every property that cs2kz does not provide is left Unknown / empty.
 * Nothing is inferred from descriptions, screenshots or guesses.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'public', 'data', 'maps.json');

const MAPS_URL = 'https://api.cs2kz.org/maps?limit=10000';
const STEAM_DETAILS_URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';

/** Tier names are taken verbatim from cs2kz.org's own numbering. */
const TIER_NUMBER = {
  'very-easy': 1,
  easy: 2,
  medium: 3,
  advanced: 4,
  hard: 5,
  'very-hard': 6,
  extreme: 7,
  death: 8,
  unfeasible: 9,
  impossible: 10,
};

function tierNumber(value) {
  if (typeof value !== 'string') return null;
  const tier = TIER_NUMBER[value.toLowerCase()];
  // The original Property.txt range is 1–9. Classic-mode cs2kz data currently
  // stays within 1–9; refuse to silently clamp anything outside it.
  return tier != null && tier >= 1 && tier <= 9 ? tier : null;
}

function emptyRecord() {
  return {
    id: '',
    name: '',
    global: 'Unknown',
    materials: [],
    props: [],
    topTime: null,
    tpTier: null,
    proTier: null,
    headbangers: 'Unknown',
    ladderAmount: [],
    ladderTypes: [],
    bhop: 'Unknown',
    bhopColour: null,
    multi: 'Unknown',
    multiColour: null,
    prekeep: 'Unknown',
    prekeepColour: null,
    surfAmounts: [],
    surfMaterials: [],
    port: 'Unknown',
    basedOn: '',
    weather: [],
    scenery: [],
    timeOfDay: [],
    tech: [],
    ljRoom: 'Unknown',
    ljBlock: 'Unknown',
    ladderRoom: 'Unknown',
    path: [],
    special: [],
    bonus: 'Unknown',
    mappers: '',
    description: '',
    thumbnail: null,
    workshopId: null,
    cs2kzId: null,
    updatedAt: new Date().toISOString(),
    notes: '',
  };
}

function mapRecordFromCs2kz(map) {
  const record = emptyRecord();
  const courses = Array.isArray(map.courses) ? map.courses : [];
  const primary =
    courses.find((course) => typeof course.name === 'string' && course.name.toLowerCase() === 'main') ??
    courses[0];

  // Classic mode is cs2kz.org's default map-list mode; these are the numbers
  // shown on the live map list.
  const classic = primary?.filters?.classic ?? null;
  const tpTier = tierNumber(classic?.nub_tier);
  const proTier = tierNumber(classic?.pro_tier);

  record.id = map.name;
  record.name = map.name;
  record.global = 'Yes'; // cs2kz's approved global map record
  record.mappers = Array.isArray(map.mappers)
    ? map.mappers
        .map((mapper) => (typeof mapper?.name === 'string' ? mapper.name.trim() : ''))
        .filter(Boolean)
        .join(', ')
    : '';
  record.description = typeof map.description === 'string' ? map.description.trim() : '';
  record.workshopId = map.workshop_id != null ? String(map.workshop_id) : null;
  record.cs2kzId = typeof map.id === 'number' ? map.id : null;
  record.tpTier = tpTier;
  record.proTier = proTier;
  record.notes =
    primary && (tpTier != null || proTier != null)
      ? `Tiers from course “${primary.name}” (classic mode).`
      : '';
  record.updatedAt = new Date().toISOString();
  return record;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function fetchAllMaps() {
  const data = await fetchJson(MAPS_URL, { headers: { Accept: 'application/json' } });
  if (!Array.isArray(data?.values)) throw new Error('Unexpected cs2kz.org response: missing values[]');
  return data.values;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function fetchSteamPreviews(workshopIds) {
  const previews = new Map();
  const uniqueIds = [...new Set(workshopIds.filter(Boolean))];
  let batchNumber = 0;

  for (const batch of chunks(uniqueIds, 50)) {
    batchNumber++;
    const body = new URLSearchParams();
    body.set('itemcount', String(batch.length));
    batch.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));

    let data = null;
    for (let attempt = 1; attempt <= 3 && !data; attempt++) {
      try {
        data = await fetchJson(STEAM_DETAILS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
      } catch (error) {
        if (attempt === 3) {
          console.warn(`  Steam batch ${batchNumber} failed: ${error.message}`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }

    const details = data?.response?.publishedfiledetails;
    if (!Array.isArray(details)) continue;
    for (const detail of details) {
      const id = String(detail.publishedfileid ?? '');
      const preview = detail.preview_url;
      if (id && typeof preview === 'string' && preview.startsWith('https://')) {
        previews.set(id, preview);
      }
    }
    console.log(`  Steam batch ${batchNumber}/${Math.ceil(uniqueIds.length / 50)}: ${previews.size} previews found`);
  }

  return previews;
}

console.log('Fetching approved maps from cs2kz.org…');
const allMaps = await fetchAllMaps();
const approved = allMaps.filter((map) => map?.state === 'approved' && typeof map?.name === 'string');
const invalid = allMaps.length - approved.length;

if (approved.length === 0) throw new Error('cs2kz.org returned no approved maps; refusing to write an empty dataset.');

// Deduplicate by name defensively (the API currently has none).
const seen = new Set();
const unique = approved.filter((map) => {
  const key = map.name.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const records = unique.map(mapRecordFromCs2kz);
const withTiers = records.filter((record) => record.tpTier != null || record.proTier != null);

console.log(`Fetching workshop thumbnails for ${records.length} maps…`);
let previews = new Map();
try {
  previews = await fetchSteamPreviews(records.map((record) => record.workshopId));
} catch (error) {
  console.warn(`Thumbnail lookup skipped: ${error.message}`);
}
for (const record of records) {
  if (record.workshopId && previews.has(record.workshopId)) record.thumbnail = previews.get(record.workshopId);
}

const dataset = {
  version: 2,
  updatedAt: new Date().toISOString(),
  source: 'https://cs2kz.org',
  maps: records,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`);

const withThumbs = records.filter((record) => record.thumbnail).length;
console.log('');
console.log(`Wrote ${records.length} approved maps to public/data/maps.json`);
console.log(`  skipped ${invalid} non-approved cs2kz records`);
console.log(`  tiers filled for ${withTiers.length}/${records.length} maps (classic mode, primary course)`);
console.log(`  thumbnails resolved for ${withThumbs}/${records.length} maps`);
console.log('  all other properties are Unknown / empty by design');
console.log('');
console.log('Run `npm run build` to rebuild public/data/maps.zip.');
