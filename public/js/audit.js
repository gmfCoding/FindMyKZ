/**
 * Private per-map audit trail viewer.
 *
 * The trail lives on the server and is only readable with the audit token
 * configured via FINDMYKZ_AUDIT_TOKEN. Only changed values are shown, always as
 * "old → new".
 */
import { fetchAudit, getAuditToken, getEditToken, getEditorName, setAuditToken, setEditToken, setEditorName, } from './api.js';
import { $, escapeHtml, required } from './util.js';
let modalEl = null;
let titleEl = null;
let subEl = null;
let listEl = null;
let statusEl = null;
let tokenEl = null;
let editTokenEl = null;
let editorEl = null;
let showOpensEl = null;
let currentMapId = null;
let currentMapName = '';
let serverAvailable = true;
let lastEntries = [];
function refs() {
    if (modalEl)
        return true;
    modalEl = $('#audit-modal');
    if (!modalEl)
        return false;
    titleEl = $('#audit-title');
    subEl = $('#audit-sub');
    listEl = $('#audit-list');
    statusEl = $('#audit-status');
    tokenEl = $('#audit-token');
    editTokenEl = $('#edit-token');
    editorEl = $('#audit-editor');
    showOpensEl = $('#audit-show-opens');
    return true;
}
function setStatus(message, state = 'idle') {
    if (!statusEl)
        return;
    statusEl.textContent = message;
    statusEl.dataset.state = state;
    statusEl.hidden = !message;
}
function formatValue(value) {
    if (value === null || value === undefined || value === '')
        return '—';
    if (Array.isArray(value))
        return value.length === 0 ? '—' : value.join(', ');
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    return String(value);
}
function formatStamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
function renderEntries() {
    if (!listEl)
        return;
    const showOpens = showOpensEl?.checked ?? false;
    const entries = lastEntries.filter((entry) => showOpens || entry.action !== 'open');
    if (entries.length === 0) {
        listEl.innerHTML = `<p class="audit-empty">${lastEntries.length === 0
            ? 'No audit events recorded for this map yet.'
            : 'Only edit-open events are recorded so far. Tick “Show edit opens” to see them.'}</p>`;
        return;
    }
    listEl.innerHTML = entries
        .map((entry) => {
        const heading = `<header class="audit-entry-head">
        <span class="audit-badge ${escapeHtml(entry.action)}">${escapeHtml(entry.action)}</span>
        <span class="audit-rev">r${entry.revision}</span>
        <span class="audit-actor">${escapeHtml(entry.actor)}</span>
        <time datetime="${escapeHtml(entry.at)}">${escapeHtml(formatStamp(entry.at))}</time>
      </header>`;
        if (entry.changes.length === 0) {
            return `<article class="audit-entry">${heading}<p class="audit-nochange">Opened for editing — no values changed.</p></article>`;
        }
        const rows = entry.changes
            .map((change) => `<li>
            <span class="audit-field">${escapeHtml(change.field)}</span>
            <span class="audit-from">${escapeHtml(formatValue(change.from))}</span>
            <span class="audit-arrow" aria-hidden="true">→</span>
            <span class="audit-to">${escapeHtml(formatValue(change.to))}</span>
          </li>`)
            .join('');
        return `<article class="audit-entry">${heading}<ul class="audit-changes">${rows}</ul></article>`;
    })
        .join('');
}
async function load() {
    if (!currentMapId || !tokenEl || !listEl)
        return;
    if (!serverAvailable) {
        lastEntries = [];
        renderEntries();
        setStatus('The audit trail needs the Node backend. Start it with `npm start`.', 'error');
        return;
    }
    const token = tokenEl.value.trim();
    if (!token) {
        lastEntries = [];
        renderEntries();
        setStatus('Enter the audit token configured in FINDMYKZ_AUDIT_TOKEN on the server.', 'error');
        return;
    }
    setAuditToken(token);
    setEditToken(editTokenEl?.value ?? '');
    setEditorName(editorEl?.value ?? '');
    setStatus('Loading audit trail…', 'loading');
    const result = await fetchAudit(currentMapId, token);
    if (!result.ok) {
        lastEntries = [];
        renderEntries();
        setStatus(result.status === 403
            ? 'The audit trail is disabled on the server. Restart it with FINDMYKZ_AUDIT_TOKEN set.'
            : result.status === 401
                ? 'That audit token was rejected.'
                : `Could not load the audit trail: ${result.error}`, 'error');
        return;
    }
    lastEntries = result.data.entries ?? [];
    renderEntries();
    const count = lastEntries.filter((entry) => entry.action !== 'open').length;
    setStatus(count === 0
        ? 'No value changes recorded yet.'
        : `${count} value-changing event${count === 1 ? '' : 's'} · newest first`, 'idle');
}
function close() {
    if (!modalEl)
        return;
    modalEl.hidden = true;
    document.body.classList.remove('modal-open');
}
export function openAuditDialog(mapId, mapName, apiAvailable) {
    if (!refs() || !modalEl)
        return;
    currentMapId = mapId;
    currentMapName = mapName;
    serverAvailable = apiAvailable;
    if (titleEl)
        titleEl.textContent = `Audit trail · ${mapName || mapId}`;
    if (subEl) {
        subEl.textContent = apiAvailable
            ? 'Private, per-map history. Only fields whose value changed are recorded, with the old and new value.'
            : 'Private, per-map history. Requires the Node backend — this page is running on static data.';
    }
    if (tokenEl)
        tokenEl.value = getAuditToken();
    if (editTokenEl)
        editTokenEl.value = getEditToken();
    if (editorEl)
        editorEl.value = getEditorName();
    lastEntries = [];
    renderEntries();
    setStatus('');
    modalEl.hidden = false;
    document.body.classList.add('modal-open');
    if (tokenEl)
        window.setTimeout(() => tokenEl?.focus(), 60);
    if (serverAvailable)
        void load();
}
export function bindAuditDialog() {
    if (!refs() || !modalEl)
        return;
    $$Close().forEach((button) => button.addEventListener('click', close));
    required('#audit-refresh').addEventListener('click', () => void load());
    tokenEl?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void load();
        }
    });
    editorEl?.addEventListener('change', () => {
        setEditorName(editorEl?.value ?? '');
    });
    editTokenEl?.addEventListener('change', () => {
        setEditToken(editTokenEl?.value ?? '');
    });
    showOpensEl?.addEventListener('change', renderEntries);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalEl && !modalEl.hidden)
            close();
    });
}
function $$Close() {
    return Array.from(modalEl?.querySelectorAll('[data-audit-close]') ?? []);
}
//# sourceMappingURL=audit.js.map