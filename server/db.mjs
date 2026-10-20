/**
 * Lightweight persistence for FindMyKZ.
 *
 * Uses the SQLite build that ships with Node (`node:sqlite`, Node >= 22.5) so
 * there is no native dependency to compile and no database server to run.
 *
 * Tables
 *   maps       one row per map: the normalized record as JSON + a revision
 *   map_audit  append-only, per-map audit trail (private, never served publicly)
 *   meta       tiny key/value table for dataset metadata
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeDataset, normalizeRecord } from '../public/js/data.js';
import { defaultMapRecord } from '../public/js/types.js';
import {
  computeChanges,
  computeDeletionChanges,
  computeInitialChanges,
} from './audit.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_DB_PATH = join(ROOT, 'server', 'data', 'findmykz.db');
const SEED_JSON = join(ROOT, 'public', 'data', 'maps.json');

export const DB_PATH = process.env.FINDMYKZ_DB
  ? resolve(process.env.FINDMYKZ_DB)
  : DEFAULT_DB_PATH;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS maps (
    id          TEXT PRIMARY KEY,
    record      TEXT NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS map_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id          TEXT NOT NULL,
    revision        INTEGER NOT NULL,
    action          TEXT NOT NULL,
    actor           TEXT NOT NULL,
    client          TEXT,
    ip              TEXT,
    user_agent      TEXT,
    changes         TEXT NOT NULL,
    changed_fields  INTEGER NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_map_audit_map ON map_audit (map_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_map_audit_created ON map_audit (created_at DESC);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failures, surface the original error
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Seed the database from the generated static dataset the first time it boots.
 * Seeding is the baseline, not a user edit, so it writes no audit rows.
 */
function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM maps').get();
  if (n > 0 || !existsSync(SEED_JSON)) return 0;

  let dataset;
  try {
    dataset = normalizeDataset(JSON.parse(readFileSync(SEED_JSON, 'utf8')));
  } catch (error) {
    console.warn(`[findmykz] Could not seed from ${SEED_JSON}: ${error.message}`);
    return 0;
  }

  const stamp = now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO maps (id, record, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
  );

  transaction(() => {
    for (const map of dataset.maps) insert.run(map.id, JSON.stringify(map), stamp, map.updatedAt || stamp);
    setMeta('seededFrom', 'public/data/maps.json');
    setMeta('seededAt', stamp);
    setMeta('datasetUpdatedAt', dataset.updatedAt || stamp);
  });

  return dataset.maps.length;
}

export const seededCount = seedIfEmpty();

/**
 * Records stored before the catalogue state existed (or holding the old
 * "Unknown" value) become Uncatalogued. This is a baseline migration, so it
 * deliberately writes no audit rows.
 */
function migrateCatalogueDefaults() {
  if (getMeta('catalogueDefault') === 'uncatalogued-v1') return 0;

  const rows = db.prepare('SELECT id, record FROM maps').all();
  const update = db.prepare('UPDATE maps SET record = ? WHERE id = ?');
  let changed = 0;

  transaction(() => {
    for (const row of rows) {
      let record;
      try {
        record = JSON.parse(row.record);
      } catch {
        continue;
      }
      if (record.catalogued === 'Catalogued' || record.catalogued === 'Uncatalogued') continue;
      record.catalogued = 'Uncatalogued';
      update.run(JSON.stringify(record), row.id);
      changed += 1;
    }
    setMeta('catalogueDefault', 'uncatalogued-v1');
  });

  return changed;
}

export const catalogueMigrated = migrateCatalogueDefaults();

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function actorOf(meta) {
  const actor = typeof meta?.actor === 'string' ? meta.actor.trim() : '';
  return (actor || 'anonymous').slice(0, 80);
}

function insertAudit({ mapId, revision, action, meta, changes }) {
  db.prepare(
    `INSERT INTO map_audit
       (map_id, revision, action, actor, client, ip, user_agent, changes, changed_fields, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mapId,
    revision,
    action,
    actorOf(meta),
    meta?.client ?? null,
    meta?.ip ?? null,
    meta?.userAgent ?? null,
    JSON.stringify(changes),
    changes.length,
    now(),
  );
}

function parseAuditRow(row) {
  let changes = [];
  try {
    changes = JSON.parse(row.changes);
  } catch {
    changes = [];
  }
  return {
    id: row.id,
    mapId: row.map_id,
    revision: row.revision,
    action: row.action,
    actor: row.actor,
    client: row.client,
    ip: row.ip,
    userAgent: row.user_agent,
    at: row.created_at,
    changes,
  };
}

/** Audit trail for a single map, newest first. */
export function listAudit(mapId, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM map_audit WHERE map_id = ? ORDER BY id DESC LIMIT ${safeLimit}`)
    .all(mapId);
  return rows.map(parseAuditRow);
}

/**
 * Record that a browser opened a map for editing. Repeated opens by the same
 * client within `windowMs` collapse into one entry so the trail stays readable.
 */
export function logEditOpen(mapId, meta, windowMs = 30 * 60 * 1000) {
  const exists = db.prepare('SELECT 1 AS ok FROM maps WHERE id = ?').get(mapId);
  if (!exists) return false;

  const since = new Date(Date.now() - windowMs).toISOString();
  const recent = db
    .prepare(
      `SELECT 1 AS ok FROM map_audit
       WHERE map_id = ? AND action = 'open' AND actor = ? AND IFNULL(client, '') = ? AND created_at >= ?
       LIMIT 1`,
    )
    .get(mapId, actorOf(meta), meta?.client ?? '', since);
  if (recent) return false;

  const row = db.prepare('SELECT revision FROM maps WHERE id = ?').get(mapId);
  insertAudit({
    mapId,
    revision: row?.revision ?? 1,
    action: 'open',
    meta,
    changes: [],
  });
  return true;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function mapCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM maps').get().n;
}

export function datasetUpdatedAt() {
  const row = db.prepare('SELECT MAX(updated_at) AS stamp FROM maps').get();
  return row?.stamp || getMeta('datasetUpdatedAt') || now();
}

export function getMap(id) {
  const row = db.prepare('SELECT record, revision, created_at, updated_at FROM maps WHERE id = ?').get(id);
  if (!row) return null;
  return {
    map: JSON.parse(row.record),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listMaps() {
  return db
    .prepare('SELECT record FROM maps ORDER BY id')
    .all()
    .map((row) => JSON.parse(row.record));
}

export function listRevisions() {
  const revisions = {};
  for (const row of db.prepare('SELECT id, revision FROM maps').all()) revisions[row.id] = row.revision;
  return revisions;
}

export function datasetSnapshot() {
  const maps = listMaps();
  return {
    version: 1,
    updatedAt: datasetUpdatedAt(),
    maps,
    revisions: listRevisions(),
  };
}

// ---------------------------------------------------------------------------
// Writes (each write is transactional with its audit row)
// ---------------------------------------------------------------------------

/**
 * @returns {{status:'ok', map:object, revision:number, changes:object[]}
 *          |{status:'exists', revision:number}}
 */
export function createMap(input, meta = {}) {
  const record = normalizeRecord(input);
  record.id = String(input?.id ?? record.id).trim();

  const existing = getMap(record.id);
  if (existing) return { status: 'exists', revision: existing.revision };

  const stamp = now();
  record.updatedAt = stamp;
  const changes = computeInitialChanges(record);

  transaction(() => {
    db.prepare(
      'INSERT INTO maps (id, record, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
    ).run(record.id, JSON.stringify(record), stamp, stamp);
    insertAudit({ mapId: record.id, revision: 1, action: 'create', meta, changes });
  });

  return { status: 'ok', map: record, revision: 1, changes };
}

/**
 * @param {object} input full record (PUT replaces the stored record)
 * @param {{expectedRevision?: number|null, meta?: object}} options
 */
export function updateMap(id, input, { expectedRevision = null, meta = {} } = {}) {
  const current = getMap(id);
  if (!current) return { status: 'missing' };

  if (expectedRevision != null && expectedRevision !== current.revision) {
    return { status: 'conflict', revision: current.revision, map: current.map };
  }

  const next = normalizeRecord({ ...input, id });
  next.id = id;
  next.updatedAt = now();

  const changes = computeChanges(current.map, next);
  if (changes.length === 0) {
    return { status: 'unchanged', map: current.map, revision: current.revision, changes: [] };
  }

  const revision = current.revision + 1;

  transaction(() => {
    db.prepare('UPDATE maps SET record = ?, revision = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      revision,
      next.updatedAt,
      id,
    );
    insertAudit({ mapId: id, revision, action: 'update', meta, changes });
  });

  return { status: 'ok', map: next, revision, changes };
}

export function deleteMap(id, { expectedRevision = null, meta = {} } = {}) {
  const current = getMap(id);
  if (!current) return { status: 'missing' };

  if (expectedRevision != null && expectedRevision !== current.revision) {
    return { status: 'conflict', revision: current.revision, map: current.map };
  }

  const changes = computeDeletionChanges(current.map);

  transaction(() => {
    db.prepare('DELETE FROM maps WHERE id = ?').run(id);
    // The audit row deliberately outlives the map.
    insertAudit({ mapId: id, revision: current.revision + 1, action: 'delete', meta, changes });
  });

  return { status: 'ok', map: current.map, revision: current.revision + 1, changes };
}

/** Fresh empty record, used by tests and tooling. */
export function blankRecord(id = 'kz_new_map', name = id) {
  return defaultMapRecord(name, id);
}

export function closeDb() {
  try {
    db.close();
  } catch {
    // already closed
  }
}
