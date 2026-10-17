import {
  AMOUNTS,
  COLOURS,
  LADDER_TYPES,
  MATERIALS,
  PATHS,
  PORTS,
  SCENERY,
  SPECIALS,
  TIMES_OF_DAY,
  WEATHER,
  type Amount,
  type Colour,
  type LjBlockValue,
  type MapDataset,
  type MapRecord,
  type Material,
  type PathTag,
  type Port,
  type Scenery,
  type Special,
  type TimeOfDay,
  type Tri,
  type Weather,
  defaultMapRecord,
} from './types.js';
import { readFirstJsonEntry } from './zip.js';

const DB_NAME = 'findmykz';
const DB_STORE = 'kv';
const DB_KEY = 'working-dataset';
const LS_KEY = 'findmykz.dataset.v1';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asTri(value: unknown): Tri {
  if (value === 'Yes' || value === 'No' || value === 'Unknown') return value;
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

function asLjBlock(value: unknown): LjBlockValue {
  if (value === 'Yes' || value === 'No' || value === 'Specific' || value === 'Unknown') return value;
  return 'Unknown';
}

function asTier(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 9 ? rounded : null;
}

function asTopTime(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const set = new Set<string>(allowed);
  return Array.from(new Set(asArray(value).filter((item): item is T => typeof item === 'string' && set.has(item))));
}

function asColour(value: unknown): Colour | null {
  return typeof value === 'string' && (COLOURS as readonly string[]).includes(value)
    ? (value as Colour)
    : null;
}

export function normalizeRecord(raw: unknown): MapRecord {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = asString(source.name).trim() || 'Untitled map';
  const base = defaultMapRecord(name, asString(source.id) || name);
  return {
    ...base,
    id: asString(source.id) || name,
    name,
    global: asTri(source.global),
    materials: enumArray<Material>(source.materials, MATERIALS),
    props: enumArray<Amount>(source.props, AMOUNTS),
    topTime: asTopTime(source.topTime),
    vnlTopTime: asTopTime(source.vnlTopTime),
    tpTier: asTier(source.tpTier),
    proTier: asTier(source.proTier),
    headbangers: asTri(source.headbangers),
    ladderAmount: enumArray<Amount>(source.ladderAmount, AMOUNTS),
    ladderTypes: enumArray(source.ladderTypes, LADDER_TYPES),
    bhop: asTri(source.bhop),
    bhopColour: asColour(source.bhopColour),
    multi: asTri(source.multi),
    multiColour: asColour(source.multiColour),
    prekeep: asTri(source.prekeep),
    prekeepColour: asColour(source.prekeepColour),
    surfAmounts: enumArray<Amount>(source.surfAmounts, AMOUNTS),
    surfMaterials: enumArray<Material>(source.surfMaterials, MATERIALS),
    port: (typeof source.port === 'string' && (PORTS as readonly string[]).includes(source.port)
      ? source.port
      : 'Unknown') as Port,
    basedOn: asString(source.basedOn).slice(0, 255),
    weather: enumArray<Weather>(source.weather, WEATHER),
    scenery: enumArray<Scenery>(source.scenery, SCENERY),
    timeOfDay: enumArray<TimeOfDay>(source.timeOfDay, TIMES_OF_DAY),
    tech: Array.from(
      new Set(asArray(source.tech).filter((item): item is string => typeof item === 'string' && item.length > 0)),
    ),
    ljRoom: asTri(source.ljRoom),
    ljBlock: asLjBlock(source.ljBlock),
    ladderRoom: asTri(source.ladderRoom),
    path: enumArray<PathTag>(source.path, PATHS),
    special: enumArray<Special>(source.special, SPECIALS),
    bonus: asTri(source.bonus),
    mappers: asString(source.mappers).slice(0, 255),
    description: asString(source.description),
    thumbnail: typeof source.thumbnail === 'string' && source.thumbnail.trim() ? source.thumbnail.trim() : null,
    workshopId:
      typeof source.workshopId === 'string' || typeof source.workshopId === 'number'
        ? String(source.workshopId)
        : null,
    cs2kzId:
      typeof source.cs2kzId === 'number'
        ? source.cs2kzId
        : typeof source.cs2kzId === 'string' && source.cs2kzId.trim()
          ? Number(source.cs2kzId) || null
          : null,
    updatedAt: asString(source.updatedAt) || new Date().toISOString(),
    notes: asString(source.notes) || undefined,
  };
}

export function normalizeDataset(raw: unknown): MapDataset {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(raw) ? raw : asArray(source.maps);
  const maps = list.map(normalizeRecord);
  // De-duplicate by id, keeping the last record.
  const byId = new Map<string, MapRecord>();
  for (const map of maps) byId.set(map.id, map);
  return {
    version: typeof source.version === 'number' ? source.version : 1,
    updatedAt: asString(source.updatedAt) || new Date().toISOString(),
    maps: Array.from(byId.values()),
  };
}

export function toDataset(maps: MapRecord[]): MapDataset {
  return { version: 1, updatedAt: new Date().toISOString(), maps };
}

export function datasetToJson(dataset: MapDataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}

const DATA_SOURCES = [
  { url: 'data/maps.zip', zip: true },
  { url: 'data/maps.json', zip: false },
] as const;

export interface LoadedDataset {
  dataset: MapDataset;
  source: string;
}

export async function loadServedDataset(): Promise<LoadedDataset> {
  const errors: string[] = [];
  for (const source of DATA_SOURCES) {
    try {
      const response = await fetch(source.url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (source.zip) {
        const buffer = await response.arrayBuffer();
        const text = await readFirstJsonEntry(buffer);
        return { dataset: normalizeDataset(JSON.parse(text)), source: source.url };
      }
      return { dataset: normalizeDataset(await response.json()), source: source.url };
    } catch (error) {
      errors.push(`${source.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Could not load the map database. ${errors.join(' · ')}. Serve the \`public\` folder over HTTP (npm run serve) and make sure public/data/maps.zip exists.`,
  );
}

export async function readDatasetFile(file: File): Promise<MapDataset> {
  const isZip =
    file.name.toLowerCase().endsWith('.zip') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed';
  if (isZip) {
    const text = await readFirstJsonEntry(await file.arrayBuffer());
    return normalizeDataset(JSON.parse(text));
  }
  return normalizeDataset(JSON.parse(await file.text()));
}

// ---------------------------------------------------------------------------
// Working copy persistence (IndexedDB, with localStorage fallback)
// ---------------------------------------------------------------------------

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadWorkingDataset(): Promise<MapDataset | null> {
  try {
    const db = await openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (value) return normalizeDataset(value);
  } catch {
    // fall through to localStorage
  }
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return normalizeDataset(JSON.parse(stored));
  } catch {
    // ignore
  }
  return null;
}

export async function saveWorkingDataset(dataset: MapDataset): Promise<boolean> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(dataset, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(dataset));
      return true;
    } catch {
      return false;
    }
  }
}

export async function clearWorkingDataset(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}
