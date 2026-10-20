/**
 * HTTP API for FindMyKZ map property submission.
 *
 *   GET    /api/health                 service + database status
 *   GET    /api/maps                   full dataset (public read) + revisions
 *   GET    /api/maps/:id               one map (public read)
 *   POST   /api/maps                   create a map record
 *   PUT    /api/maps/:id               replace a map record (optimistic locking)
 *   DELETE /api/maps/:id               delete a map record
 *   POST   /api/maps/:id/open          record that a browser opened it for editing
 *   GET    /api/maps/:id/audit         PRIVATE per-map audit trail (token required)
 *
 *   GET    /api/suggestions            public suggestions, most liked first
 *   POST   /api/suggestions            post a suggestion (no sign-in)
 *   POST   /api/suggestions/:id/vote   { value: 1 | -1 | 0 } up/down-vote or clear (no sign-in)
 */
import { timingSafeEqual } from 'node:crypto';

import { validateSuggestion } from '../public/js/suggestion-types.js';
import * as store from './db.mjs';
import * as suggestions from './suggestions.mjs';

const EDIT_TOKEN = process.env.FINDMYKZ_EDIT_TOKEN ?? '';
const AUDIT_TOKEN = process.env.FINDMYKZ_AUDIT_TOKEN ?? '';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, If-Match, Authorization, X-Editor, X-Client, X-Editor-Token, X-Audit-Token',
  );
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Revision');
  res.setHeader('Access-Control-Max-Age', '600');
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function fail(res, status, code, message, extra = {}) {
  json(res, status, { error: code, message, ...extra });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

function tokenMatches(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.replace(/^Bearer\s+/i, '');
}

function editorAllowed(req) {
  if (!EDIT_TOKEN) return true;
  return tokenMatches(req.headers['x-editor-token'] ?? bearer(req), EDIT_TOKEN);
}

function auditAllowed(req) {
  if (!AUDIT_TOKEN) return { ok: false, status: 403, reason: 'disabled' };
  const provided = req.headers['x-audit-token'] ?? bearer(req);
  return tokenMatches(provided, AUDIT_TOKEN)
    ? { ok: true }
    : { ok: false, status: 401, reason: 'invalid' };
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

/** Anonymous per-browser identity used to de-duplicate suggestion votes. */
function voterFrom(req) {
  const raw = req.headers['x-client'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9._-]{8,64}$/.test(id) ? id : '';
}

const rateBuckets = new Map();

/** Small in-memory sliding window so the open endpoints cannot be hammered. */
function rateLimited(bucket, req, max, windowMs) {
  const key = `${bucket}:${clientIp(req) ?? 'unknown'}`;
  const cutoff = Date.now() - windowMs;
  const hits = (rateBuckets.get(key) ?? []).filter((at) => at > cutoff);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(Date.now());
  rateBuckets.set(key, hits);
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, hits] of rateBuckets) {
    if (hits.every((at) => at <= cutoff)) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

function metaFrom(req, body) {
  const actor =
    (typeof body?.actor === 'string' && body.actor.trim()) ||
    (typeof req.headers['x-editor'] === 'string' && req.headers['x-editor'].trim()) ||
    'anonymous';
  return {
    actor,
    client: typeof req.headers['x-client'] === 'string' ? req.headers['x-client'].slice(0, 64) : null,
    ip: clientIp(req),
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null,
  };
}

function expectedRevision(req, body) {
  const raw =
    req.headers['if-match'] ?? body?.version ?? body?.revision ?? body?.expectedRevision ?? null;
  if (raw == null || raw === '') return null;
  const parsed = Number(String(raw).replace(/^W\//, '').replace(/"/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function slugify(input) {
  const slug = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'kz_new_map';
}

/** Accept either a bare record or `{ map: {...}, version: n }`. */
function recordFrom(body) {
  if (!body || typeof body !== 'object') return null;
  const candidate = body.map && typeof body.map === 'object' ? body.map : body;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  return candidate;
}

function validateRecord(record) {
  if (!record) return 'Send a map record as the JSON body.';
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    return 'A map record needs a non-empty "name".';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleApi(req, res, url) {
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) return false;

  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'findmykz',
        database: 'sqlite',
        maps: store.mapCount(),
        writes: EDIT_TOKEN ? 'token' : 'open',
        audit: AUDIT_TOKEN ? 'token' : 'disabled',
      });
      return true;
    }

    if (pathname === '/api/suggestions' && req.method === 'GET') {
      json(res, 200, { suggestions: suggestions.listSuggestions(voterFrom(req)) });
      return true;
    }

    if (pathname === '/api/suggestions' && req.method === 'POST') {
      const voter = voterFrom(req);
      if (!voter) {
        fail(res, 400, 'invalid_client', 'A browser client id (X-Client header) is required.');
        return true;
      }
      if (rateLimited('suggest', req, 10, 60 * 60 * 1000)) {
        fail(res, 429, 'rate_limited', 'Too many suggestions. Please try again later.');
        return true;
      }
      const checked = validateSuggestion(await readJson(req));
      if (!checked.ok) {
        fail(res, 400, 'invalid_suggestion', checked.message);
        return true;
      }
      json(res, 201, { suggestion: suggestions.createSuggestion(checked.value, voter) });
      return true;
    }

    const voteMatch = pathname.match(/^\/api\/suggestions\/(\d+)\/vote$/);
    if (voteMatch && req.method === 'POST') {
      const voter = voterFrom(req);
      if (!voter) {
        fail(res, 400, 'invalid_client', 'A browser client id (X-Client header) is required.');
        return true;
      }
      if (rateLimited('vote', req, 120, 60 * 1000)) {
        fail(res, 429, 'rate_limited', 'Voting too fast. Please slow down.');
        return true;
      }
      const body = await readJson(req);
      if (body?.value !== 1 && body?.value !== -1 && body?.value !== 0) {
        fail(res, 400, 'invalid_vote', 'Vote value must be 1, -1 or 0.');
        return true;
      }
      const updated = suggestions.castVote(Number(voteMatch[1]), voter, body.value);
      if (!updated) {
        fail(res, 404, 'not_found', 'No such suggestion.');
        return true;
      }
      json(res, 200, { suggestion: updated });
      return true;
    }

    if (pathname === '/api/maps' && req.method === 'GET') {
      const snapshot = store.datasetSnapshot();
      json(res, 200, {
        ...snapshot,
        source: 'sqlite',
        auditEnabled: Boolean(AUDIT_TOKEN),
        writesLocked: Boolean(EDIT_TOKEN),
      });
      return true;
    }

    if (pathname === '/api/maps' && req.method === 'POST') {
      if (!editorAllowed(req)) {
        fail(res, 401, 'unauthorized', 'A valid edit token is required.');
        return true;
      }

      const body = await readJson(req);
      const record = recordFrom(body);
      const problem = validateRecord(record);
      if (problem) {
        fail(res, 400, 'invalid_record', problem);
        return true;
      }

      const id = String(record.id ?? '').trim() || slugify(record.name);
      if (!ID_PATTERN.test(id)) {
        fail(res, 400, 'invalid_id', 'Map ids use lowercase letters, numbers, dots, dashes and underscores.');
        return true;
      }

      const result = store.createMap({ ...record, id }, metaFrom(req, body));
      if (result.status === 'exists') {
        fail(res, 409, 'already_exists', `Map "${id}" already exists. Use PUT to update it.`, {
          version: result.revision,
        });
        return true;
      }

      json(res, 201, { map: result.map, version: result.revision, changes: result.changes });
      return true;
    }

    const auditMatch = pathname.match(/^\/api\/maps\/([^/]+)\/audit$/);
    if (auditMatch && req.method === 'GET') {
      const id = decodeURIComponent(auditMatch[1]);
      const allowed = auditAllowed(req);
      if (!allowed.ok) {
        fail(
          res,
          allowed.status,
          allowed.reason === 'disabled' ? 'audit_disabled' : 'unauthorized',
          allowed.reason === 'disabled'
            ? 'The audit trail is private. Start the server with FINDMYKZ_AUDIT_TOKEN set to enable it.'
            : 'A valid audit token is required.',
        );
        return true;
      }

      const exists = store.getMap(id);
      const entries = store.listAudit(id, { limit: url.searchParams.get('limit') ?? 100 });
      if (!exists && entries.length === 0) {
        fail(res, 404, 'not_found', `No map or audit history for "${id}".`);
        return true;
      }

      json(res, 200, { mapId: id, exists: Boolean(exists), entries });
      return true;
    }

    const openMatch = pathname.match(/^\/api\/maps\/([^/]+)\/open$/);
    if (openMatch && req.method === 'POST') {
      if (!editorAllowed(req)) {
        fail(res, 401, 'unauthorized', 'A valid edit token is required.');
        return true;
      }
      const id = decodeURIComponent(openMatch[1]);
      const body = await readJson(req);
      const recorded = store.logEditOpen(id, metaFrom(req, body));
      json(res, 200, { mapId: id, recorded });
      return true;
    }

    const mapMatch = pathname.match(/^\/api\/maps\/([^/]+)$/);
    if (mapMatch) {
      const id = decodeURIComponent(mapMatch[1]);

      if (req.method === 'GET') {
        const found = store.getMap(id);
        if (!found) {
          fail(res, 404, 'not_found', `No map with id "${id}".`);
          return true;
        }
        json(res, 200, { map: found.map, version: found.revision });
        return true;
      }

      if (req.method === 'PUT') {
        if (!editorAllowed(req)) {
          fail(res, 401, 'unauthorized', 'A valid edit token is required.');
          return true;
        }
        const body = await readJson(req);
        const record = recordFrom(body);
        const problem = validateRecord(record);
        if (problem) {
          fail(res, 400, 'invalid_record', problem);
          return true;
        }

        const result = store.updateMap(id, record, {
          expectedRevision: expectedRevision(req, body),
          meta: metaFrom(req, body),
        });

        if (result.status === 'missing') {
          fail(res, 404, 'not_found', `No map with id "${id}". Use POST to create it.`);
          return true;
        }
        if (result.status === 'conflict') {
          fail(res, 409, 'version_conflict', 'This map changed since you loaded it.', {
            version: result.revision,
            map: result.map,
          });
          return true;
        }

        json(res, 200, {
          map: result.map,
          version: result.revision,
          changedFields: result.changes.length,
          changes: result.changes,
        });
        return true;
      }

      if (req.method === 'DELETE') {
        if (!editorAllowed(req)) {
          fail(res, 401, 'unauthorized', 'A valid edit token is required.');
          return true;
        }
        const body = await readJson(req);
        const result = store.deleteMap(id, {
          expectedRevision: expectedRevision(req, body),
          meta: metaFrom(req, body),
        });
        if (result.status === 'missing') {
          fail(res, 404, 'not_found', `No map with id "${id}".`);
          return true;
        }
        if (result.status === 'conflict') {
          fail(res, 409, 'version_conflict', 'This map changed since you loaded it.', {
            version: result.revision,
            map: result.map,
          });
          return true;
        }
        json(res, 200, { deleted: id, version: result.revision });
        return true;
      }
    }

    fail(res, 404, 'not_found', `No API route for ${req.method} ${pathname}.`);
    return true;
  } catch (error) {
    const status = error?.status ?? 500;
    if (status >= 500) console.error('[findmykz] API error:', error);
    fail(res, status, 'request_failed', error?.message ?? 'Unexpected server error.');
    return true;
  }
}

export const apiConfig = {
  writesLocked: Boolean(EDIT_TOKEN),
  auditEnabled: Boolean(AUDIT_TOKEN),
};
