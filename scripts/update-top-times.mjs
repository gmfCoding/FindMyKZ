#!/usr/bin/env node
/**
 * Fills topTime (classic / CKZ) and vnlTopTime (vanilla / VNL) in
 * public/data/maps.json from cs2kz.org's public records API.
 *
 * For each map, the primary course is the same one used for TP/Pro tiers:
 * the course named "Main" (case-insensitive), otherwise the first course.
 * Only the two top-time fields are modified; every other property is preserved.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapsPath = join(root, 'public', 'data', 'maps.json');
const MAPS_API = 'https://api.cs2kz.org/maps?limit=10000';
const RECORDS_API = 'https://api.cs2kz.org/records';
const MODES = [
  { mode: 'classic', field: 'topTime', label: 'CKZ' },
  { mode: 'vanilla', field: 'vnlTopTime', label: 'VNL' },
];
const REQUEST_DELAY_MS = 140;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Request failed: ${url} (${lastError instanceof Error ? lastError.message : lastError})`);
}

async function fetchTopTime(mapName, courseName, mode) {
  const url = new URL(RECORDS_API);
  url.searchParams.set('top', 'true');
  url.searchParams.set('mode', mode);
  url.searchParams.set('map', mapName);
  url.searchParams.set('course', courseName);
  url.searchParams.set('sort_by', 'time');
  url.searchParams.set('sort_order', 'ascending');
  url.searchParams.set('limit', '1');

  const data = await fetchJson(url);
  const record = Array.isArray(data?.values) ? data.values[0] : null;
  if (!record) return null;

  // Guard against a filter regression returning a different map/course.
  const returnedMap = record.map?.name;
  const returnedCourse = record.course?.name;
  if (returnedMap && returnedMap.toLowerCase() !== mapName.toLowerCase()) {
    throw new Error(`API returned map “${returnedMap}” while requesting “${mapName}”`);
  }
  if (returnedCourse && returnedCourse.toLowerCase() !== courseName.toLowerCase()) {
    throw new Error(`API returned course “${returnedCourse}” while requesting “${courseName}”`);
  }

  const time = Number(record.time);
  return Number.isFinite(time) && time > 0 ? time : null;
}

const dataset = JSON.parse(await readFile(mapsPath, 'utf8'));
if (!Array.isArray(dataset.maps)) throw new Error('maps.json has no maps array');

const apiData = await fetchJson(MAPS_API);
const apiMaps = (Array.isArray(apiData?.values) ? apiData.values : []).filter(
  (map) => map?.state === 'approved' && typeof map?.name === 'string',
);
const apiByName = new Map(apiMaps.map((map) => [map.name.toLowerCase(), map]));

console.log(`Updating top times for ${dataset.maps.length} maps…`);

let classicFound = 0;
let vnlFound = 0;
let skipped = 0;
let index = 0;

for (const record of dataset.maps) {
  index++;
  const apiMap = apiByName.get(String(record.name).toLowerCase());
  if (!apiMap) {
    skipped++;
    console.log(`  [${index}/${dataset.maps.length}] ${record.name}: skipped (not in cs2kz approved list)`);
    continue;
  }

  const courses = Array.isArray(apiMap.courses) ? apiMap.courses : [];
  const primary =
    courses.find((course) => typeof course.name === 'string' && course.name.toLowerCase() === 'main') ??
    courses[0];

  if (!primary?.name) {
    skipped++;
    console.log(`  [${index}/${dataset.maps.length}] ${record.name}: skipped (no course)`);
    continue;
  }

  for (const { mode, field, label } of MODES) {
    const time = await fetchTopTime(record.name, primary.name, mode);
    record[field] = time;
    if (time != null) {
      if (mode === 'classic') classicFound++;
      else vnlFound++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `  [${index}/${dataset.maps.length}] ${record.name} · ${primary.name}: CKZ ${record.topTime ?? '—'} / VNL ${record.vnlTopTime ?? '—'}`,
  );
}

dataset.version = Math.max(Number(dataset.version) || 1, 3);
dataset.updatedAt = new Date().toISOString();
dataset.topTimesSource = 'https://api.cs2kz.org/records';
dataset.topTimesUpdatedAt = dataset.updatedAt;

await writeFile(mapsPath, `${JSON.stringify(dataset, null, 2)}\n`);

console.log('');
console.log(`Updated public/data/maps.json`);
console.log(`  CKZ top times found: ${classicFound}`);
console.log(`  VNL top times found: ${vnlFound}`);
console.log(`  maps skipped: ${skipped}`);
console.log('Run `npm run build` to rebuild public/data/maps.zip.');
