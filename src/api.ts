/**
 * Browser client for the FindMyKZ backend.
 *
 * All writes go through POST/PUT/DELETE and are persisted in SQLite by the
 * Node server. The editor identity and the private audit token are kept in the
 * browser only and sent as headers.
 */
import { normalizeDataset } from './data.js';
import type { MapDataset, MapRecord } from './types.js';

const API_BASE = 'api';

const EDITOR_NAME_KEY = 'findmykz.editor.name';
const CLIENT_ID_KEY = 'findmykz.client.id';
const EDIT_TOKEN_KEY = 'findmykz.edit.token';
const AUDIT_TOKEN_KEY = 'findmykz.audit.token';

export interface ServerSnapshot {
  dataset: MapDataset;
  revisions: Record<string, number>;
}

export interface MapWriteResult {
  map: MapRecord;
  version: number;
  changes?: AuditChange[];
}

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: number;
  mapId: string;
  revision: number;
  action: 'create' | 'update' | 'delete' | 'open' | string;
  actor: string;
  client: string | null;
  ip: string | null;
  userAgent: string | null;
  at: string;
  changes: AuditChange[];
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; data: unknown };

interface ServerDatasetPayload extends MapDataset {
  revisions?: Record<string, number>;
}

function readStorage(key: string, session = false): string {
  try {
    return (session ? sessionStorage : localStorage).getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string, session = false): void {
  try {
    if (value) (session ? sessionStorage : localStorage).setItem(key, value);
    else (session ? sessionStorage : localStorage).removeItem(key);
  } catch {
    // storage can be unavailable in private modes — the client keeps working
  }
}

function randomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export function getClientId(): string {
  let id = readStorage(CLIENT_ID_KEY);
  if (!id) {
    id = `browser-${randomId()}`;
    writeStorage(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getEditorName(): string {
  return readStorage(EDITOR_NAME_KEY);
}

export function setEditorName(name: string): void {
  writeStorage(EDITOR_NAME_KEY, name.trim().slice(0, 80));
}

export function getEditToken(): string {
  return readStorage(EDIT_TOKEN_KEY, true);
}

export function setEditToken(token: string): void {
  writeStorage(EDIT_TOKEN_KEY, token.trim(), true);
}

export function getAuditToken(): string {
  return readStorage(AUDIT_TOKEN_KEY, true);
}

export function setAuditToken(token: string): void {
  writeStorage(AUDIT_TOKEN_KEY, token.trim(), true);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Editor': getEditorName() || 'anonymous',
    'X-Client': getClientId(),
    ...options.headers,
  };

  const editToken = getEditToken();
  if (editToken) headers['X-Editor-Token'] = editToken;

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${API_BASE}/${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
    const data = await parseBody(response);

    if (!response.ok) {
      const payload = (data ?? {}) as { message?: string; error?: string };
      return {
        ok: false,
        status: response.status,
        error: payload.message || payload.error || `HTTP ${response.status}`,
        data,
      };
    }

    return { ok: true, status: response.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: 'Server unreachable', data: null };
  }
}

/** Load the full dataset plus per-map revisions. Returns null when offline. */
export async function fetchSnapshot(): Promise<ServerSnapshot | null> {
  const result = await request<ServerDatasetPayload>('GET', 'maps');
  if (!result.ok) return null;
  return {
    dataset: normalizeDataset(result.data),
    revisions: result.data.revisions ?? {},
  };
}

export async function createMapRecord(record: MapRecord): Promise<ApiResult<MapWriteResult>> {
  return request<MapWriteResult>('POST', 'maps', { body: record });
}

export async function updateMapRecord(
  record: MapRecord,
  revision: number | null,
): Promise<ApiResult<MapWriteResult>> {
  const headers: Record<string, string> = {};
  if (revision != null) headers['If-Match'] = String(revision);
  return request<MapWriteResult>('PUT', `maps/${encodeURIComponent(record.id)}`, {
    body: record,
    headers,
  });
}

export async function deleteMapRecord(
  id: string,
  revision: number | null,
): Promise<ApiResult<{ deleted: string; version: number }>> {
  const headers: Record<string, string> = {};
  if (revision != null) headers['If-Match'] = String(revision);
  return request<{ deleted: string; version: number }>('DELETE', `maps/${encodeURIComponent(id)}`, {
    headers,
  });
}

/** Tells the server a browser opened this record for editing (private audit). */
export async function openMapForEdit(id: string): Promise<void> {
  await request<{ recorded: boolean }>('POST', `maps/${encodeURIComponent(id)}/open`, { body: {} });
}

export async function fetchAudit(
  mapId: string,
  token: string,
): Promise<ApiResult<{ mapId: string; exists: boolean; entries: AuditEntry[] }>> {
  return request('GET', `maps/${encodeURIComponent(mapId)}/audit?limit=200`, {
    headers: { 'X-Audit-Token': token },
  });
}
