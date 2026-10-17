#!/usr/bin/env node
/**
 * Pulls Counter-Strike 2 Workshop items whose titles start with kz_ or bkz_
 * and writes public/data/maps_steam.json.
 *
 * The Steam Workshop browse page embeds its search results as JSON in the
 * `valve-ssr-data` script tag, including pagination. This script paginates the
 * public search for "kz_" and "bkz_", keeps only titles with those prefixes,
 * and stores the real Workshop metadata. Nothing is inferred.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'public', 'data', 'maps_steam.json');

const APP_ID = 730; // Counter-Strike 2
const QUERIES = ['kz_', 'bkz_'];
const PAGE_DELAY_MS = 300;
const MAX_PAGES = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildUrl(query, page) {
  const url = new URL('https://steamcommunity.com/workshop/browse/');
  url.searchParams.set('appid', String(APP_ID));
  url.searchParams.set('searchtext', query);
  url.searchParams.set('childpublishedfileid', '0');
  url.searchParams.set('browsesort', 'textsearch');
  url.searchParams.set('section', 'readytouseitems');
  url.searchParams.set('actualsort', 'textsearch');
  url.searchParams.set('p', String(page));
  return url.toString();
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 FindMyKZ-data/1.0',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function extractSearchData(html) {
  const script = html.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) throw new Error('Steam Workshop page did not contain valve-ssr-data.');

  const ssr = JSON.parse(script[1]);
  let queryData = ssr?.renderContext?.queryData;
  if (typeof queryData === 'string') queryData = JSON.parse(queryData);
  let queries = queryData?.queries;
  if (typeof queries === 'string') queries = JSON.parse(queries);
  if (!Array.isArray(queries)) throw new Error('Could not find Workshop query data.');

  for (const query of queries) {
    const data = query?.state?.data;
    if (data && Array.isArray(data.results) && Number.isFinite(data.total_pages)) return data;
  }
  throw new Error('Could not find Workshop search results in the page.');
}

function epochToIso(value) {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return new Date(epoch * 1000).toISOString();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isKzTitle(title) {
  const lower = title.trim().toLowerCase();
  return lower.startsWith('kz_') || lower.startsWith('bkz_');
}

function mapFromResult(item) {
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  if (!title || !isKzTitle(title)) return null;
  if (Number(item.file_type) !== 0) return null;

  const workshopId = String(item.publishedfileid ?? '');
  if (!workshopId) return null;

  const tags = Array.isArray(item.tags)
    ? item.tags.map((tag) => (typeof tag?.tag === 'string' ? tag.tag : '')).filter(Boolean)
    : [];

  // Only actual Workshop maps, not menus/configs that happen to use a kz_ prefix.
  if (!tags.some((tag) => tag.toLowerCase() === 'map')) return null;

  return {
    workshopId,
    name: title,
    title,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(workshopId)}`,
    previewUrl: typeof item.preview_url === 'string' && item.preview_url ? item.preview_url : null,
    description: typeof item.short_description === 'string' ? item.short_description.trim() : '',
    creatorSteamId: item.creator != null ? String(item.creator) : null,
    timeCreated: epochToIso(item.time_created),
    timeUpdated: epochToIso(item.time_updated),
    fileSize: numberOrNull(item.file_size),
    tags,
    subscriptions: numberOrNull(item.subscriptions),
    favorited: numberOrNull(item.favorited),
    views: numberOrNull(item.views),
    starRating: numberOrNull(item.star_rating),
    totalVotes: numberOrNull(item.total_votes),
    workshopAccepted: item.workshop_accepted === true,
    appId: APP_ID,
  };
}

const collected = new Map();
let totalRawResults = 0;
let totalPagesSeen = 0;

for (const query of QUERIES) {
  console.log(`Searching Steam Workshop for “${query}”…`);
  const firstUrl = buildUrl(query, 1);
  const firstHtml = await fetchHtml(firstUrl);
  const first = extractSearchData(firstHtml);

  const pages = Math.min(Math.max(1, Number(first.total_pages) || 1), MAX_PAGES);
  console.log(`  ${first.total_count} results across ${pages} page(s)`);

  const pageResults = [first];
  for (let page = 2; page <= pages; page++) {
    await sleep(PAGE_DELAY_MS);
    const html = await fetchHtml(buildUrl(query, page));
    pageResults.push(extractSearchData(html));
    process.stdout.write(`\r  fetched page ${page}/${pages}`);
  }
  if (pages > 1) process.stdout.write('\n');

  for (const data of pageResults) {
    totalPagesSeen++;
    totalRawResults += data.results.length;
    for (const item of data.results) {
      const map = mapFromResult(item);
      if (map) collected.set(map.workshopId, map);
    }
  }
  console.log(`  kept ${collected.size} unique kz_/bkz_ maps so far`);
}

const maps = [...collected.values()].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
);

const dataset = {
  source: 'https://steamcommunity.com/workshop/browse/?appid=730',
  appId: APP_ID,
  queries: QUERIES,
  generatedAt: new Date().toISOString(),
  count: maps.length,
  maps,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`);

const withMapTag = maps.filter((map) => map.tags.some((tag) => tag.toLowerCase() === 'map')).length;
const withPreview = maps.filter((map) => map.previewUrl).length;
console.log('');
console.log(`Wrote ${maps.length} maps to public/data/maps_steam.json`);
console.log(`  ${totalRawResults} raw results scanned from ${totalPagesSeen} page(s)`);
console.log(`  ${withMapTag} have the Steam “Map” tag`);
console.log(`  ${withPreview} have a preview image`);
