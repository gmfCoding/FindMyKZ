import { normalizeRecord } from './data.js';
import type { MapRecord } from './types.js';

export const DELTA_FORMAT = 'findmykz-changes';
export const DELTA_VERSION = 1;
const DELTA_STORAGE_KEY = 'findmykz.changes.v1';

/** Fields that can appear in a per-map patch. `updatedAt` is added automatically. */
const PATCHABLE_FIELDS: (keyof MapRecord)[] = [
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

export interface DeltaSet {
  format: typeof DELTA_FORMAT;
  version: typeof DELTA_VERSION;
  /** The `updatedAt` of the served base dataset this delta applies to. */
  baseUpdatedAt: string;
  exportedAt: string;
  changes: Record<string, Partial<MapRecord>>;
  added: Record<string, MapRecord>;
  deleted: string[];
}

export function emptyDelta(baseUpdatedAt = ''): DeltaSet {
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cleanPatch(patch: unknown): Partial<MapRecord> | null {
  if (!patch || typeof patch !== 'object') return null;
  const source = patch as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  }
  if (Object.prototype.hasOwnProperty.call(source, 'updatedAt')) result.updatedAt = source.updatedAt;
  return Object.keys(result).length ? (result as Partial<MapRecord>) : null;
}

export function computeRecordPatch(base: MapRecord, record: MapRecord): Partial<MapRecord> | null {
  const patch: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (!equal(base[field], record[field])) patch[field] = clone(record[field]);
  }
  if (Object.keys(patch).length === 0) return null;
  patch.updatedAt = record.updatedAt;
  return patch as Partial<MapRecord>;
}

export function buildDelta(baseMaps: MapRecord[], records: MapRecord[], baseUpdatedAt: string): DeltaSet {
  const baseById = new Map(baseMaps.map((map) => [map.id, map]));
  const currentIds = new Set(records.map((record) => record.id));
  const changes: Record<string, Partial<MapRecord>> = {};
  const added: Record<string, MapRecord> = {};

  for (const record of records) {
    const base = baseById.get(record.id);
    if (!base) {
      added[record.id] = clone(record);
      continue;
    }
    const patch = computeRecordPatch(base, record);
    if (patch) changes[record.id] = patch;
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

export function applyDelta(baseMaps: MapRecord[], delta: DeltaSet): MapRecord[] {
  const deleted = new Set(delta.deleted ?? []);
  const seen = new Set<string>();
  const result: MapRecord[] = [];

  for (const base of baseMaps) {
    if (deleted.has(base.id)) continue;
    const patch = delta.changes?.[base.id];
    const merged = patch ? { ...base, ...patch } : base;
    const normalized = normalizeRecord(merged);
    result.push(normalized);
    seen.add(normalized.id);
  }

  for (const record of Object.values(delta.added ?? {})) {
    if (deleted.has(record.id) || seen.has(record.id)) continue;
    const normalized = normalizeRecord(record);
    result.push(normalized);
    seen.add(normalized.id);
  }

  return result;
}

export function deltaCount(delta: DeltaSet): number {
  return (
    Object.keys(delta.changes ?? {}).length +
    Object.keys(delta.added ?? {}).length +
    (delta.deleted?.length ?? 0)
  );
}

export function deltaRecordIds(delta: DeltaSet): Set<string> {
  return new Set([
    ...Object.keys(delta.changes ?? {}),
    ...Object.keys(delta.added ?? {}),
  ]);
}

export function isDeltaSet(value: unknown): value is DeltaSet {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DeltaSet>;
  return (
    candidate.format === DELTA_FORMAT &&
    typeof candidate.changes === 'object' &&
    candidate.changes !== null &&
    !Array.isArray(candidate.changes) &&
    typeof candidate.added === 'object' &&
    candidate.added !== null &&
    !Array.isArray(candidate.added) &&
    Array.isArray(candidate.deleted)
  );
}

/** Validates an imported delta and strips unknown fields. */
export function normalizeDelta(value: unknown, fallbackBaseUpdatedAt = ''): DeltaSet | null {
  if (!isDeltaSet(value)) return null;
  const changes: Record<string, Partial<MapRecord>> = {};
  for (const [id, patch] of Object.entries(value.changes)) {
    const clean = cleanPatch(patch);
    if (clean) changes[id] = clean;
  }
  const added: Record<string, MapRecord> = {};
  for (const [id, record] of Object.entries(value.added)) {
    if (record && typeof record === 'object') added[id] = normalizeRecord(record);
  }
  const deleted = Array.from(
    new Set((value.deleted ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
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

export function loadDelta(): DeltaSet | null {
  try {
    const raw = localStorage.getItem(DELTA_STORAGE_KEY);
    if (!raw) return null;
    return normalizeDelta(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDelta(delta: DeltaSet): boolean {
  try {
    localStorage.setItem(DELTA_STORAGE_KEY, JSON.stringify(delta));
    return true;
  } catch {
    return false;
  }
}

export function clearDelta(): void {
  try {
    localStorage.removeItem(DELTA_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
