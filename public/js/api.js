/**
 * Browser client for the FindMyKZ backend.
 *
 * All writes go through POST/PUT/DELETE and are persisted in SQLite by the
 * Node server. The editor identity and the private audit token are kept in the
 * browser only and sent as headers.
 */
import { normalizeDataset } from './data.js';
const API_BASE = 'api';
const EDITOR_NAME_KEY = 'findmykz.editor.name';
const CLIENT_ID_KEY = 'findmykz.client.id';
const EDIT_TOKEN_KEY = 'findmykz.edit.token';
const AUDIT_TOKEN_KEY = 'findmykz.audit.token';
function readStorage(key, session = false) {
    try {
        return (session ? sessionStorage : localStorage).getItem(key) ?? '';
    }
    catch {
        return '';
    }
}
function writeStorage(key, value, session = false) {
    try {
        if (value)
            (session ? sessionStorage : localStorage).setItem(key, value);
        else
            (session ? sessionStorage : localStorage).removeItem(key);
    }
    catch {
        // storage can be unavailable in private modes — the client keeps working
    }
}
function randomId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid)
        return uuid.slice(0, 8);
    return Math.random().toString(36).slice(2, 10);
}
export function getClientId() {
    let id = readStorage(CLIENT_ID_KEY);
    if (!id) {
        id = `browser-${randomId()}`;
        writeStorage(CLIENT_ID_KEY, id);
    }
    return id;
}
export function getEditorName() {
    return readStorage(EDITOR_NAME_KEY);
}
export function setEditorName(name) {
    writeStorage(EDITOR_NAME_KEY, name.trim().slice(0, 80));
}
export function getEditToken() {
    return readStorage(EDIT_TOKEN_KEY, true);
}
export function setEditToken(token) {
    writeStorage(EDIT_TOKEN_KEY, token.trim(), true);
}
export function getAuditToken() {
    return readStorage(AUDIT_TOKEN_KEY, true);
}
export function setAuditToken(token) {
    writeStorage(AUDIT_TOKEN_KEY, token.trim(), true);
}
async function parseBody(response) {
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function request(method, path, options = {}) {
    const headers = {
        Accept: 'application/json',
        'X-Editor': getEditorName() || 'anonymous',
        'X-Client': getClientId(),
        ...options.headers,
    };
    const editToken = getEditToken();
    if (editToken)
        headers['X-Editor-Token'] = editToken;
    if (options.body !== undefined)
        headers['Content-Type'] = 'application/json';
    try {
        const response = await fetch(`${API_BASE}/${path}`, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            cache: 'no-store',
        });
        const data = await parseBody(response);
        if (!response.ok) {
            const payload = (data ?? {});
            return {
                ok: false,
                status: response.status,
                error: payload.message || payload.error || `HTTP ${response.status}`,
                data,
            };
        }
        return { ok: true, status: response.status, data: data };
    }
    catch {
        return { ok: false, status: 0, error: 'Server unreachable', data: null };
    }
}
/** Load the full dataset plus per-map revisions. Returns null when offline. */
export async function fetchSnapshot() {
    const result = await request('GET', 'maps');
    if (!result.ok)
        return null;
    return {
        dataset: normalizeDataset(result.data),
        revisions: result.data.revisions ?? {},
    };
}
export async function createMapRecord(record) {
    return request('POST', 'maps', { body: record });
}
export async function updateMapRecord(record, revision) {
    const headers = {};
    if (revision != null)
        headers['If-Match'] = String(revision);
    return request('PUT', `maps/${encodeURIComponent(record.id)}`, {
        body: record,
        headers,
    });
}
export async function deleteMapRecord(id, revision) {
    const headers = {};
    if (revision != null)
        headers['If-Match'] = String(revision);
    return request('DELETE', `maps/${encodeURIComponent(id)}`, {
        headers,
    });
}
/** Tells the server a browser opened this record for editing (private audit). */
export async function openMapForEdit(id) {
    await request('POST', `maps/${encodeURIComponent(id)}/open`, { body: {} });
}
export async function fetchAudit(mapId, token) {
    return request('GET', `maps/${encodeURIComponent(mapId)}/audit?limit=200`, {
        headers: { 'X-Audit-Token': token },
    });
}
//# sourceMappingURL=api.js.map