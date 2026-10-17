import { AMOUNTS, COLOURS, LADDER_TYPES, MATERIALS, PATHS, PORTS, SCENERY, SPECIALS, TIMES_OF_DAY, WEATHER, defaultMapRecord, } from './types.js';
import { readFirstJsonEntry } from './zip.js';
const DB_NAME = 'findmykz';
const DB_STORE = 'kv';
const DB_KEY = 'working-dataset';
const LS_KEY = 'findmykz.dataset.v1';
function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function asTri(value) {
    if (value === 'Yes' || value === 'No' || value === 'Unknown')
        return value;
    if (value === true)
        return 'Yes';
    if (value === false)
        return 'No';
    return 'Unknown';
}
function asLjBlock(value) {
    if (value === 'Yes' || value === 'No' || value === 'Specific' || value === 'Unknown')
        return value;
    return 'Unknown';
}
function asTier(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return null;
    const rounded = Math.round(n);
    return rounded >= 1 && rounded <= 9 ? rounded : null;
}
function asTopTime(value) {
    if (value == null || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function enumArray(value, allowed) {
    const set = new Set(allowed);
    return Array.from(new Set(asArray(value).filter((item) => typeof item === 'string' && set.has(item))));
}
function asColour(value) {
    return typeof value === 'string' && COLOURS.includes(value)
        ? value
        : null;
}
export function normalizeRecord(raw) {
    const source = (raw && typeof raw === 'object' ? raw : {});
    const name = asString(source.name).trim() || 'Untitled map';
    const base = defaultMapRecord(name, asString(source.id) || name);
    return {
        ...base,
        id: asString(source.id) || name,
        name,
        global: asTri(source.global),
        materials: enumArray(source.materials, MATERIALS),
        props: enumArray(source.props, AMOUNTS),
        topTime: asTopTime(source.topTime),
        vnlTopTime: asTopTime(source.vnlTopTime),
        tpTier: asTier(source.tpTier),
        proTier: asTier(source.proTier),
        headbangers: asTri(source.headbangers),
        ladderAmount: enumArray(source.ladderAmount, AMOUNTS),
        ladderTypes: enumArray(source.ladderTypes, LADDER_TYPES),
        bhop: asTri(source.bhop),
        bhopColour: asColour(source.bhopColour),
        multi: asTri(source.multi),
        multiColour: asColour(source.multiColour),
        prekeep: asTri(source.prekeep),
        prekeepColour: asColour(source.prekeepColour),
        surfAmounts: enumArray(source.surfAmounts, AMOUNTS),
        surfMaterials: enumArray(source.surfMaterials, MATERIALS),
        port: (typeof source.port === 'string' && PORTS.includes(source.port)
            ? source.port
            : 'Unknown'),
        basedOn: asString(source.basedOn).slice(0, 255),
        weather: enumArray(source.weather, WEATHER),
        scenery: enumArray(source.scenery, SCENERY),
        timeOfDay: enumArray(source.timeOfDay, TIMES_OF_DAY),
        tech: Array.from(new Set(asArray(source.tech).filter((item) => typeof item === 'string' && item.length > 0))),
        ljRoom: asTri(source.ljRoom),
        ljBlock: asLjBlock(source.ljBlock),
        ladderRoom: asTri(source.ladderRoom),
        path: enumArray(source.path, PATHS),
        special: enumArray(source.special, SPECIALS),
        bonus: asTri(source.bonus),
        mappers: asString(source.mappers).slice(0, 255),
        description: asString(source.description),
        thumbnail: typeof source.thumbnail === 'string' && source.thumbnail.trim() ? source.thumbnail.trim() : null,
        workshopId: typeof source.workshopId === 'string' || typeof source.workshopId === 'number'
            ? String(source.workshopId)
            : null,
        cs2kzId: typeof source.cs2kzId === 'number'
            ? source.cs2kzId
            : typeof source.cs2kzId === 'string' && source.cs2kzId.trim()
                ? Number(source.cs2kzId) || null
                : null,
        updatedAt: asString(source.updatedAt) || new Date().toISOString(),
        notes: asString(source.notes) || undefined,
    };
}
export function normalizeDataset(raw) {
    const source = (raw && typeof raw === 'object' ? raw : {});
    const list = Array.isArray(raw) ? raw : asArray(source.maps);
    const maps = list.map(normalizeRecord);
    // De-duplicate by id, keeping the last record.
    const byId = new Map();
    for (const map of maps)
        byId.set(map.id, map);
    return {
        version: typeof source.version === 'number' ? source.version : 1,
        updatedAt: asString(source.updatedAt) || new Date().toISOString(),
        maps: Array.from(byId.values()),
    };
}
export function toDataset(maps) {
    return { version: 1, updatedAt: new Date().toISOString(), maps };
}
export function datasetToJson(dataset) {
    return `${JSON.stringify(dataset, null, 2)}\n`;
}
const DATA_SOURCES = [
    { url: 'data/maps.zip', zip: true },
    { url: 'data/maps.json', zip: false },
];
export async function loadServedDataset() {
    const errors = [];
    for (const source of DATA_SOURCES) {
        try {
            const response = await fetch(source.url, { cache: 'no-cache' });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            if (source.zip) {
                const buffer = await response.arrayBuffer();
                const text = await readFirstJsonEntry(buffer);
                return { dataset: normalizeDataset(JSON.parse(text)), source: source.url };
            }
            return { dataset: normalizeDataset(await response.json()), source: source.url };
        }
        catch (error) {
            errors.push(`${source.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`Could not load the map database. ${errors.join(' · ')}. Serve the \`public\` folder over HTTP (npm run serve) and make sure public/data/maps.zip exists.`);
}
export async function readDatasetFile(file) {
    const isZip = file.name.toLowerCase().endsWith('.zip') ||
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
function openDatabase() {
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
export async function loadWorkingDataset() {
    try {
        const db = await openDatabase();
        const value = await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const request = tx.objectStore(DB_STORE).get(DB_KEY);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        if (value)
            return normalizeDataset(value);
    }
    catch {
        // fall through to localStorage
    }
    try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored)
            return normalizeDataset(JSON.parse(stored));
    }
    catch {
        // ignore
    }
    return null;
}
export async function saveWorkingDataset(dataset) {
    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(dataset, DB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        return true;
    }
    catch {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(dataset));
            return true;
        }
        catch {
            return false;
        }
    }
}
export async function clearWorkingDataset() {
    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).delete(DB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }
    catch {
        // ignore
    }
    try {
        localStorage.removeItem(LS_KEY);
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=data.js.map