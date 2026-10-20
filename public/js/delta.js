import { normalizeRecord } from './data.js';
export const DELTA_FORMAT = 'findmykz-changes';
export const DELTA_VERSION = 1;
const DELTA_STORAGE_KEY = 'findmykz.changes.v1';
/** Fields that can appear in a per-map patch. `updatedAt` is added automatically. */
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
export function emptyDelta(baseUpdatedAt = '') {
    return {
        format: DELTA_FORMAT,
        version: DELTA_VERSION,
        baseUpdatedAt,
        exportedAt: new Date().toISOString(),
        changes: {},
        added: {},
        deleted: [],
    };
}
function clone(value) {
    return structuredClone(value);
}
function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function cleanPatch(patch) {
    if (!patch || typeof patch !== 'object')
        return null;
    const source = patch;
    const result = {};
    for (const field of PATCHABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(source, field))
            result[field] = source[field];
    }
    if (Object.prototype.hasOwnProperty.call(source, 'updatedAt'))
        result.updatedAt = source.updatedAt;
    return Object.keys(result).length ? result : null;
}
export function computeRecordPatch(base, record) {
    const patch = {};
    for (const field of PATCHABLE_FIELDS) {
        if (!equal(base[field], record[field]))
            patch[field] = clone(record[field]);
    }
    if (Object.keys(patch).length === 0)
        return null;
    patch.updatedAt = record.updatedAt;
    return patch;
}
export function buildDelta(baseMaps, records, baseUpdatedAt) {
    const baseById = new Map(baseMaps.map((map) => [map.id, map]));
    const currentIds = new Set(records.map((record) => record.id));
    const changes = {};
    const added = {};
    for (const record of records) {
        const base = baseById.get(record.id);
        if (!base) {
            added[record.id] = clone(record);
            continue;
        }
        const patch = computeRecordPatch(base, record);
        if (patch)
            changes[record.id] = patch;
    }
    return {
        format: DELTA_FORMAT,
        version: DELTA_VERSION,
        baseUpdatedAt,
        exportedAt: new Date().toISOString(),
        changes,
        added,
        deleted: baseMaps.filter((map) => !currentIds.has(map.id)).map((map) => map.id),
    };
}
export function applyDelta(baseMaps, delta) {
    const deleted = new Set(delta.deleted ?? []);
    const seen = new Set();
    const result = [];
    for (const base of baseMaps) {
        if (deleted.has(base.id))
            continue;
        const patch = delta.changes?.[base.id];
        const merged = patch ? { ...base, ...patch } : base;
        const normalized = normalizeRecord(merged);
        result.push(normalized);
        seen.add(normalized.id);
    }
    for (const record of Object.values(delta.added ?? {})) {
        if (deleted.has(record.id) || seen.has(record.id))
            continue;
        const normalized = normalizeRecord(record);
        result.push(normalized);
        seen.add(normalized.id);
    }
    return result;
}
export function deltaCount(delta) {
    return (Object.keys(delta.changes ?? {}).length +
        Object.keys(delta.added ?? {}).length +
        (delta.deleted?.length ?? 0));
}
export function deltaRecordIds(delta) {
    return new Set([
        ...Object.keys(delta.changes ?? {}),
        ...Object.keys(delta.added ?? {}),
    ]);
}
export function isDeltaSet(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return (candidate.format === DELTA_FORMAT &&
        typeof candidate.changes === 'object' &&
        candidate.changes !== null &&
        !Array.isArray(candidate.changes) &&
        typeof candidate.added === 'object' &&
        candidate.added !== null &&
        !Array.isArray(candidate.added) &&
        Array.isArray(candidate.deleted));
}
/** Validates an imported delta and strips unknown fields. */
export function normalizeDelta(value, fallbackBaseUpdatedAt = '') {
    if (!isDeltaSet(value))
        return null;
    const changes = {};
    for (const [id, patch] of Object.entries(value.changes)) {
        const clean = cleanPatch(patch);
        if (clean)
            changes[id] = clean;
    }
    const added = {};
    for (const [id, record] of Object.entries(value.added)) {
        if (record && typeof record === 'object')
            added[id] = normalizeRecord(record);
    }
    const deleted = Array.from(new Set((value.deleted ?? []).filter((id) => typeof id === 'string' && id.length > 0)));
    return {
        format: DELTA_FORMAT,
        version: DELTA_VERSION,
        baseUpdatedAt: typeof value.baseUpdatedAt === 'string' ? value.baseUpdatedAt : fallbackBaseUpdatedAt,
        exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(),
        changes,
        added,
        deleted,
    };
}
export function loadDelta() {
    try {
        const raw = localStorage.getItem(DELTA_STORAGE_KEY);
        if (!raw)
            return null;
        return normalizeDelta(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
export function saveDelta(delta) {
    try {
        localStorage.setItem(DELTA_STORAGE_KEY, JSON.stringify(delta));
        return true;
    }
    catch {
        return false;
    }
}
export function clearDelta() {
    try {
        localStorage.removeItem(DELTA_STORAGE_KEY);
    }
    catch {
        // Ignore storage failures.
    }
}
//# sourceMappingURL=delta.js.map