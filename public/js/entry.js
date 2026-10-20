import { createMapRecord, deleteMapRecord, fetchSnapshot, openMapForEdit, updateMapRecord, } from './api.js';
import { bindAuditDialog, openAuditDialog } from './audit.js';
import { clearWorkingDataset, datasetToJson, loadServedDataset, loadWorkingDataset, normalizeDataset, readJsonFile, toDataset, } from './data.js';
import { applyDelta, buildDelta, clearDelta, deltaCount, deltaRecordIds, emptyDelta, isDeltaSet, loadDelta, normalizeDelta, saveDelta, } from './delta.js';
import { CommandPalette } from './palette.js';
import { AMOUNTS, CATALOGUE_STATES, COLOURS, LADDER_TYPES, LJ_BLOCK_OPTIONS, MATERIALS, PATHS, PORTS, SCENERY, SCENERY_GROUPS, SPECIALS, TIMES_OF_DAY, TRI_OPTIONS, WEATHER, defaultMapRecord, } from './types.js';
import { $, $$, escapeHtml, formatTopTime, mapInitials, matchesAllTokens, parseTopTimeInput, required, slugify, thumbStyle, } from './util.js';
import { createZip } from './zip.js';
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let records = [];
let selectedId = null;
let baseDataset = { version: 1, updatedAt: new Date().toISOString(), maps: [] };
let baseRecords = [];
let delta = emptyDelta();
let recordQuery = '';
let saveTimer;
let palette;
let lookupResults = [];
let lastAutoLookup = '';
let baseSourceLabel = 'Not loaded';
const autoIds = new Set();
/** True when the Node API answered; writes then go to SQLite instead of localStorage. */
let serverMode = false;
/** Last known server revision per map, used for optimistic locking (If-Match). */
let serverRevisions = new Map();
let saveRunning = false;
let saveQueued = false;
const openedForEdit = new Set();
function trackEditOpen(id) {
    if (!serverMode || !id || openedForEdit.has(id))
        return;
    openedForEdit.add(id);
    void openMapForEdit(id);
}
function changesLabel() {
    const count = deltaCount(delta);
    if (count === 0)
        return serverMode ? 'All changes saved to the database' : 'No changes';
    return serverMode
        ? `${count} unsaved map${count === 1 ? '' : 's'} · will POST/PUT to the API`
        : `${count} changed map${count === 1 ? '' : 's'} · saved in this browser`;
}
/**
 * When migrating the old full working copy, only carry over manually entered
 * properties. cs2kz-derived metadata (tiers, top times, descriptions, thumbnails…)
 * may have improved since that copy was made and must not be reverted.
 */
const MIGRATION_FIELDS = [
    'materials',
    'brickColour',
    'props',
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
    'notes',
];
function buildMigrationDelta(oldBase, legacyRecords, baseUpdatedAt) {
    const baseById = new Map(oldBase.map((record) => [record.id, record]));
    const changes = {};
    const added = {};
    for (const record of legacyRecords) {
        const base = baseById.get(record.id);
        if (!base) {
            added[record.id] = structuredClone(record);
            continue;
        }
        const patch = {};
        for (const field of MIGRATION_FIELDS) {
            if (JSON.stringify(base[field]) !== JSON.stringify(record[field])) {
                patch[field] = structuredClone(record[field]);
            }
        }
        if (Object.keys(patch).length > 0) {
            patch.updatedAt = record.updatedAt;
            changes[record.id] = patch;
        }
    }
    // Do not delete base maps that the legacy copy simply did not know about.
    return {
        format: 'findmykz-changes',
        version: 1,
        baseUpdatedAt,
        exportedAt: new Date().toISOString(),
        changes,
        added,
        deleted: [],
    };
}
const recordListEl = required('#record-list');
const recordSearchEl = required('#record-search');
const recordCountEl = required('#record-count');
const editorHeadingEl = required('#editor-heading');
const editorSubEl = required('#editor-sub');
const editorThumbEl = required('#editor-thumb');
const editorEmptyEl = required('#editor-empty');
const formEl = required('#record-form');
const saveStatusEl = required('#save-status');
const storageStatusEl = required('#storage-status');
const toastEl = required('#toast');
const importFileEl = required('#import-file');
// Elements inside #record-form are re-created whenever the form re-renders.
let lookupNameEl = null;
let lookupStatusEl = null;
let lookupResultsEl = null;
function refreshFormRefs() {
    lookupNameEl = $('#lookup-name', formEl);
    lookupStatusEl = $('#lookup-status', formEl);
    lookupResultsEl = $('#lookup-results', formEl);
}
let toastTimer;
function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        toastEl.classList.remove('show');
        window.setTimeout(() => {
            toastEl.hidden = true;
        }, 180);
    }, 2600);
}
function setSaveStatus(text, state = 'idle') {
    saveStatusEl.textContent = text;
    saveStatusEl.dataset.state = state;
}
function current() {
    return records.find((record) => record.id === selectedId);
}
function getArrayField(record, field) {
    const value = record[field];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function setArrayField(record, field, values) {
    record[field] = values;
    // The colour belongs to the Brick material, so it goes when Brick does.
    if (field === 'materials' && !values.includes('Brick'))
        record.brickColour = null;
}
function setStringField(record, field, value) {
    record[field] = value;
}
function setNullableField(record, field, value) {
    record[field] = value;
}
// ---------------------------------------------------------------------------
// Record list
// ---------------------------------------------------------------------------
function completeness(record) {
    const checks = [
        record.name.trim().length > 0,
        record.global !== 'Unknown',
        record.materials.length > 0,
        record.props.length > 0,
        record.topTime != null,
        record.vnlTopTime != null,
        record.tpTier != null,
        record.proTier != null,
        record.headbangers !== 'Unknown',
        record.ladderAmount.length > 0,
        record.ladderTypes.length > 0,
        record.bhop !== 'Unknown',
        record.multi !== 'Unknown',
        record.prekeep !== 'Unknown',
        record.surfAmounts.length > 0,
        record.port !== 'Unknown',
        record.basedOn.trim().length > 0,
        record.weather.length > 0,
        record.scenery.length > 0,
        record.timeOfDay.length > 0,
        record.tech.length > 0,
        record.ljRoom !== 'Unknown',
        record.ljBlock !== 'Unknown',
        record.ladderRoom !== 'Unknown',
        record.path.length > 0,
        record.special.length > 0,
        record.bonus !== 'Unknown',
        record.catalogued === 'Catalogued',
    ];
    return checks.filter(Boolean).length;
}
const COMPLETENESS_TOTAL = 28;
function renderRecordList() {
    const scroll = recordListEl.scrollTop;
    const query = recordQuery.trim();
    const changedIds = deltaRecordIds(delta);
    const filtered = records
        .filter((record) => {
        if (!query)
            return true;
        return matchesAllTokens(query, [record.name, record.id, record.mappers, record.basedOn].join(' '));
    })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    recordListEl.innerHTML =
        filtered.length === 0
            ? `<div class="record-list-empty">No records match “${escapeHtml(query)}”.</div>`
            : filtered
                .map((record) => {
                const progress = Math.round((completeness(record) / COMPLETENESS_TOTAL) * 100);
                const state = record.global === 'Yes' ? 'Global' : record.global === 'No' ? 'Local' : 'Global?';
                const isCatalogued = record.catalogued === 'Catalogued';
                return `<button type="button" class="record-item${record.id === selectedId ? ' active' : ''}${changedIds.has(record.id) ? ' is-changed' : ''}" data-record-id="${escapeHtml(record.id)}">
              <span class="record-item-top">
                <span class="record-name">${escapeHtml(record.name || 'Untitled map')}</span>
                ${changedIds.has(record.id) ? '<span class="record-change-dot" title="Saved change"></span>' : ''}
                <span class="record-catalogue ${isCatalogued ? 'is-catalogued' : 'is-uncatalogued'}" title="${isCatalogued ? 'Fully catalogued' : 'Not fully catalogued'}">${isCatalogued ? 'Catalogued' : 'Uncatalogued'}</span>
                <span class="record-state ${record.global === 'Yes' ? 'is-global' : ''}">${escapeHtml(state)}</span>
              </span>
              <span class="record-meta">${record.materials.length ? escapeHtml(record.materials.slice(0, 2).join(' · ')) : 'No materials'} <span>·</span> TP ${record.tpTier ?? '—'} / Pro ${record.proTier ?? '—'}</span>
              <span class="record-progress" title="${completeness(record)}/${COMPLETENESS_TOTAL} properties filled"><span style="width:${progress}%"></span></span>
            </button>`;
            })
                .join('');
    recordListEl.scrollTop = scroll;
    const activeItem = recordListEl.querySelector('.record-item.active');
    if (activeItem) {
        const listRect = recordListEl.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();
        if (itemRect.top < listRect.top)
            recordListEl.scrollTop -= listRect.top - itemRect.top + 4;
        else if (itemRect.bottom > listRect.bottom)
            recordListEl.scrollTop += itemRect.bottom - listRect.bottom + 4;
    }
    recordCountEl.textContent = `${filtered.length} / ${records.length} records`;
    storageStatusEl.textContent = changesLabel();
    storageStatusEl.title = baseSourceLabel;
}
// ---------------------------------------------------------------------------
// Editor markup
// ---------------------------------------------------------------------------
function chipRow(field, label, values, mode, hint = '') {
    const record = current();
    if (!record)
        return '';
    const active = mode === 'array' ? getArrayField(record, field) : [];
    const currentValue = String(record[field] ?? '');
    return `<div class="form-group">
    <div class="form-label-row"><span class="form-label">${escapeHtml(label)}</span>${hint ? `<span class="form-hint">${escapeHtml(hint)}</span>` : ''}</div>
    <div class="chip-row" data-entry-group="${field}">
      ${values
        .map((value) => {
        const isActive = mode === 'array' ? active.includes(value) : currentValue === value;
        return `<button type="button" class="chip${isActive ? ' active' : ''}" data-entry-${mode}="${field}" data-value="${escapeHtml(value)}" aria-pressed="${isActive}">${escapeHtml(value)}</button>`;
    })
        .join('')}
    </div>
  </div>`;
}
function groupedChipRow(field, label, groups, hint = '') {
    const record = current();
    if (!record)
        return '';
    const active = getArrayField(record, field);
    return `<div class="form-group span-2">
    <div class="form-label-row"><span class="form-label">${escapeHtml(label)}</span>${hint ? `<span class="form-hint">${escapeHtml(hint)}</span>` : ''}</div>
    ${groups
        .map((group) => `<div class="sub-group">
          <span class="field-label">${escapeHtml(group.label)}</span>
          <div class="chip-row" data-entry-group="${escapeHtml(field)}">
            ${group.tags
        .map((value) => {
        const isActive = active.includes(value);
        return `<button type="button" class="chip${isActive ? ' active' : ''}" data-entry-array="${escapeHtml(field)}" data-value="${escapeHtml(value)}" aria-pressed="${isActive}">${escapeHtml(value)}</button>`;
    })
        .join('')}
          </div>
        </div>`)
        .join('')}
  </div>`;
}
function textField(field, label, placeholder = '', options = {}) {
    const record = current();
    if (!record)
        return '';
    const value = String(record[field] ?? '');
    return `<label class="form-field${options.wide ? ' span-2' : ''}">
    <span>${escapeHtml(label)}</span>
    <input type="${options.type ?? 'text'}" data-entry-text="${field}" value="${escapeHtml(value)}"
      placeholder="${escapeHtml(placeholder)}"${options.maxLength ? ` maxlength="${options.maxLength}"` : ''} autocomplete="off" spellcheck="false" />
  </label>`;
}
function selectField(field, label, values, emptyLabel = '') {
    const record = current();
    if (!record)
        return '';
    const value = String(record[field] ?? '');
    return `<label class="form-field"><span>${escapeHtml(label)}</span><select data-entry-select="${field}">
    ${emptyLabel ? `<option value=""${value === '' ? ' selected' : ''}>${escapeHtml(emptyLabel)}</option>` : ''}
    ${values
        .map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`)
        .join('')}
  </select></label>`;
}
function tierSelect(field, label) {
    const record = current();
    if (!record)
        return '';
    const value = record[field];
    return `<label class="form-field"><span>${escapeHtml(label)}</span><select data-entry-tier="${field}">
    <option value=""${value == null ? ' selected' : ''}>Unset</option>
    ${Array.from({ length: 9 }, (_, index) => index + 1)
        .map((tier) => `<option value="${tier}"${tier === value ? ' selected' : ''}>${tier}</option>`)
        .join('')}
  </select></label>`;
}
function panel(title, subtitle, body, extra = '', id = '') {
    return `<section class="form-panel ${extra}"${id ? ` id="${id}"` : ''}>
    <div class="panel-heading">
      <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
    </div>
    ${body}
  </section>`;
}
function renderForm() {
    const record = current();
    if (!record) {
        formEl.hidden = true;
        editorEmptyEl.hidden = false;
        editorHeadingEl.textContent = 'No map selected';
        editorSubEl.textContent = 'Create a record or pick one from the list.';
        editorThumbEl.innerHTML = '<span class="editor-thumb-empty">KZ</span>';
        return;
    }
    formEl.hidden = false;
    editorEmptyEl.hidden = true;
    editorHeadingEl.textContent = record.name || 'Untitled map';
    editorSubEl.textContent = `${record.id} · ${completeness(record)}/${COMPLETENESS_TOTAL} properties filled`;
    const bhopColour = record.bhopColour ?? '';
    formEl.innerHTML = `
    ${panel('Identity', 'The basics. Names beginning with kz_ are picked up by the cs2kz lookup.', `<div class="form-grid">
        ${textField('name', 'Map name', 'kz_mapname', { wide: true, maxLength: 100 })}
        ${textField('mappers', 'Mappers', 'ReDMooN, Nova', { maxLength: 255 })}
        ${textField('basedOn', 'Based on', 'Minecraft, Mirror’s Edge…', { maxLength: 255 })}
        <label class="form-field span-2"><span>Description</span><textarea data-entry-text="description" rows="2" maxlength="2000" placeholder="A short description of the map…">${escapeHtml(record.description)}</textarea></label>
      </div>
      <div class="form-grid three">
        ${chipRow('global', 'Global-ness', TRI_OPTIONS, 'exclusive', 'Global = cs2kz.org listed')}
        ${chipRow('bonus', 'Bonus map', TRI_OPTIONS, 'exclusive')}
        ${selectField('port', 'Port', PORTS)}
      </div>
      <div class="form-grid">
        ${chipRow('catalogued', 'Catalogue status', CATALOGUE_STATES, 'exclusive', 'Catalogued = every property has been verified.')}
      </div>`, 'identity-panel')}

    ${panel('Global map lookup', 'Search the cs2kz.org global map list to autofill name, mappers, tiers, workshop ID and thumbnail.', `<div class="lookup-row">
        <input id="lookup-name" class="text-input" type="text" placeholder="kz_grotto" autocomplete="off" spellcheck="false" value="${escapeHtml(record.cs2kzId ? '' : record.name)}" />
        <button type="button" class="btn accent" id="lookup-btn">Lookup + autofill</button>
      </div>
      <div id="lookup-status" class="lookup-status"></div>
      <div id="lookup-results" class="lookup-results"></div>`, 'global-panel', 'global-panel')}

    ${panel('Ranking & top time', 'Top times are stored for the main course. CKZ = classic, VNL = vanilla. Tiers run from 1 (easiest) to 9.', `<div class="form-grid four">
        <label class="form-field"><span>CKZ top time</span>
          <input type="text" data-entry-top-time value="${record.topTime == null ? '' : escapeHtml(formatTopTime(record.topTime))}" placeholder="1:23.45 or 1.5 (minutes)" autocomplete="off" spellcheck="false" />
          <span class="form-hint" data-top-time-hint>${record.topTime == null ? 'Unknown — leave blank' : formatTopTime(record.topTime)}</span>
        </label>
        <label class="form-field"><span>VNL top time</span>
          <input type="text" data-entry-vnl-top-time value="${record.vnlTopTime == null ? '' : escapeHtml(formatTopTime(record.vnlTopTime))}" placeholder="1:23.45 or 1.5 (minutes)" autocomplete="off" spellcheck="false" />
          <span class="form-hint" data-vnl-top-time-hint>${record.vnlTopTime == null ? 'Unknown — leave blank' : formatTopTime(record.vnlTopTime)}</span>
        </label>
        ${tierSelect('tpTier', 'TP tier (nub)')}
        ${tierSelect('proTier', 'Pro tier')}
      </div>`)}

    ${panel('Surfaces & props', 'Pick every material present on blocks which you can stand or surf on.', `<div class="form-grid two">
        <div class="form-group-stack">
          ${chipRow('materials', 'Materials', MATERIALS, 'array', 'What is included in the map?')}
          ${selectField('brickColour', 'Brick colour', COLOURS, 'Not set')}
        </div>
        ${chipRow('props', 'Prop blocks', AMOUNTS, 'array')}
      </div>
      <div class="form-grid two">
        ${chipRow('surfAmounts', 'Surf amount', AMOUNTS, 'array')}
        ${chipRow('surfMaterials', 'Surf materials', MATERIALS, 'array')}
      </div>
      <div class="form-grid three movement-grid">
        <div class="surface-card">
          ${chipRow('bhop', 'Bhop', TRI_OPTIONS, 'exclusive')}
          ${selectField('bhopColour', 'Bhop colour', COLOURS, 'Not set')}
        </div>
        <div class="surface-card">
          ${chipRow('multi', 'Multi', TRI_OPTIONS, 'exclusive')}
          ${selectField('multiColour', 'Multi colour', COLOURS, 'Not set')}
        </div>
        <div class="surface-card">
          ${chipRow('prekeep', 'Prekeep', TRI_OPTIONS, 'exclusive')}
          ${selectField('prekeepColour', 'Prekeep colour', COLOURS, 'Not set')}
        </div>
      </div>`)}

    ${panel('Movement & rooms', 'Ladders, headbangers, long-jump rooms and ladder rooms.', `<div class="form-grid two">
        ${chipRow('headbangers', 'Headbangers', TRI_OPTIONS, 'exclusive')}
        ${chipRow('ladderAmount', 'Ladder amount', AMOUNTS, 'array')}
        ${chipRow('ladderTypes', 'Ladder construction', LADDER_TYPES, 'array')}
      </div>
      <div class="form-grid three">
        ${chipRow('ljRoom', 'LJ room', TRI_OPTIONS, 'exclusive')}
        ${chipRow('ljBlock', 'LJ block', LJ_BLOCK_OPTIONS, 'exclusive')}
        ${chipRow('ladderRoom', 'Ladder room', TRI_OPTIONS, 'exclusive')}
      </div>`)}

    ${panel('Route & special blocks', 'How the route flows and which special movement sections appear.', `<div class="form-grid two">
        ${chipRow('path', 'Path', PATHS, 'array')}
        ${chipRow('special', 'Special blocks', SPECIALS, 'array')}
        ${chipRow('tech', 'Tech', ['Box Tech'], 'array')}
      </div>`)}

    ${panel('Scenery, weather & time', 'What the map looks like and when it takes place.', `<div class="form-grid">
        ${groupedChipRow('scenery', 'Scenery', SCENERY_GROUPS, 'Match any selected scenery tag.')}
      </div>
      <div class="form-grid two">
        ${chipRow('weather', 'Weather', WEATHER, 'array')}
        ${chipRow('timeOfDay', 'Time of day', TIMES_OF_DAY, 'array')}
      </div>`)}

    ${panel('Meta & media', 'Optional identifiers used by the static database and external links.', `<button type="button" class="thumb-preview" data-thumb-preview aria-label="Open full-size thumbnail preview"></button>
      <div class="form-grid">
        ${textField('thumbnail', 'Thumbnail URL', 'https://images.steamusercontent.com/…', { wide: true, type: 'url' })}
        ${textField('workshopId', 'Steam Workshop ID', '3121168339')}
        ${textField('cs2kzId', 'cs2kz.org map ID', '2')}
        <label class="form-field span-2"><span>Notes</span><textarea data-entry-text="notes" rows="2" placeholder="Anything worth remembering while entering data…">${escapeHtml(record.notes ?? '')}</textarea></label>
      </div>
      <div class="meta-strip">
        <span>Record ID <code>${escapeHtml(record.id)}</code></span>
        <span>Updated <code>${new Date(record.updatedAt).toLocaleString()}</code></span>
        <span class="meta-storage">${escapeHtml(changesLabel())}</span>
      </div>
      <div class="inline-actions">
        <button type="button" class="btn" id="thumb-fetch">Fetch thumbnail from Steam</button>
        <button type="button" class="btn ghost" id="thumb-clear">Remove thumbnail</button>
        <button type="button" class="btn ghost" id="copy-record">Copy record JSON</button>
      </div>`)}
  `;
    refreshFormRefs();
    updateGlobalPanel();
    updateEditorThumb();
    syncEditorControls();
}
function updateEditorThumb() {
    const record = current();
    if (!record)
        return;
    const hasThumb = Boolean(record.thumbnail);
    editorThumbEl.classList.toggle('has-thumb', hasThumb);
    editorThumbEl.setAttribute('style', thumbStyle(record.name));
    if (record.thumbnail) {
        editorThumbEl.innerHTML = `<img src="${escapeHtml(record.thumbnail)}" alt="" referrerpolicy="no-referrer" />`;
        $('img', editorThumbEl)?.addEventListener('error', () => {
            editorThumbEl.innerHTML = `<span class="editor-thumb-initials">${escapeHtml(mapInitials(record.name))}</span>`;
        });
    }
    else {
        editorThumbEl.innerHTML = `<span class="editor-thumb-initials">${escapeHtml(mapInitials(record.name))}</span>`;
    }
    renderThumbPreview(record);
}
/** Large preview shown inside the Meta & media panel. */
function renderThumbPreview(record) {
    const preview = $('[data-thumb-preview]', formEl);
    if (!preview)
        return;
    preview.classList.toggle('has-thumb', Boolean(record.thumbnail));
    preview.setAttribute('style', thumbStyle(record.name));
    if (!record.thumbnail) {
        preview.innerHTML = `<span class="thumb-preview-initials">${escapeHtml(mapInitials(record.name))}</span>
      <span class="thumb-preview-note">No thumbnail yet — paste a URL or fetch one from Steam</span>`;
        return;
    }
    preview.innerHTML = `<img src="${escapeHtml(record.thumbnail)}" alt="" referrerpolicy="no-referrer" />
    <span class="thumb-preview-hint">Click to enlarge</span>`;
    const image = $('img', preview);
    image?.addEventListener('error', () => {
        preview.classList.remove('has-thumb');
        preview.innerHTML = `<span class="thumb-preview-initials">${escapeHtml(mapInitials(record.name))}</span>
      <span class="thumb-preview-note">Thumbnail failed to load — check the URL</span>`;
    });
}
let thumbModalEl = null;
function openThumbPreview() {
    const record = current();
    if (!record?.thumbnail) {
        toast('No thumbnail to preview');
        return;
    }
    if (!thumbModalEl)
        thumbModalEl = $('#thumb-modal');
    if (!thumbModalEl)
        return;
    const image = $('#thumb-modal-img');
    const caption = $('#thumb-modal-caption');
    const link = $('#thumb-modal-link');
    if (caption)
        caption.textContent = `${record.name} · loading…`;
    if (link)
        link.href = record.thumbnail;
    if (image) {
        image.alt = `${record.name} thumbnail`;
        image.onload = () => {
            if (caption)
                caption.textContent = `${record.name} · ${image.naturalWidth}×${image.naturalHeight}`;
        };
        image.onerror = () => {
            if (caption)
                caption.textContent = `${record.name} · thumbnail failed to load`;
        };
        image.src = record.thumbnail;
    }
    thumbModalEl.hidden = false;
    document.body.classList.add('modal-open');
}
function closeThumbPreview() {
    if (!thumbModalEl)
        return;
    thumbModalEl.hidden = true;
    document.body.classList.remove('modal-open');
}
function updateGlobalPanel() {
    const record = current();
    const panel = $('#global-panel', formEl);
    if (!record || !panel)
        return;
    panel.hidden = record.global !== 'Yes';
    if (record.global === 'Yes') {
        if (lookupNameEl && !lookupNameEl.value) {
            lookupNameEl.value = record.name;
        }
        if (lookupResults.length === 0 && record.cs2kzId == null && lookupStatusEl && !lookupStatusEl.textContent) {
            setLookupStatus('Tip: click Lookup, or type a kz_ map name and leave the field to autofill.', 'hint');
        }
    }
}
function setLookupStatus(message, state = 'idle') {
    if (!lookupStatusEl)
        return;
    lookupStatusEl.textContent = message;
    lookupStatusEl.dataset.state = state;
    lookupStatusEl.hidden = !message;
}
function syncEditorControls() {
    const record = current();
    if (!record)
        return;
    $$('[data-entry-array]', formEl).forEach((button) => {
        const field = button.dataset.entryArray ?? '';
        const value = button.dataset.value ?? '';
        const active = getArrayField(record, field).includes(value);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-entry-exclusive]', formEl).forEach((button) => {
        const field = button.dataset.entryExclusive ?? '';
        const value = button.dataset.value ?? '';
        const active = String(record[field] ?? '') === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-entry-select]', formEl).forEach((select) => {
        const field = select.dataset.entrySelect ?? '';
        const value = record[field];
        select.value = value == null ? '' : String(value);
    });
    $$('[data-entry-tier]', formEl).forEach((select) => {
        const field = select.dataset.entryTier;
        select.value = record[field] == null ? '' : String(record[field]);
    });
    $$('[data-entry-text]', formEl).forEach((input) => {
        if (document.activeElement === input)
            return;
        const field = input.dataset.entryText ?? '';
        const value = record[field];
        input.value = value == null ? '' : String(value);
    });
    const timeInputs = [
        { selector: '[data-entry-top-time]', field: 'topTime' },
        { selector: '[data-entry-vnl-top-time]', field: 'vnlTopTime' },
    ];
    for (const { selector, field } of timeInputs) {
        const input = $(selector, formEl);
        if (input && document.activeElement !== input) {
            input.value = record[field] == null ? '' : formatTopTime(record[field]);
            input.classList.remove('invalid');
        }
    }
    editorHeadingEl.textContent = record.name || 'Untitled map';
    editorSubEl.textContent = `${record.id} · ${completeness(record)}/${COMPLETENESS_TOTAL} properties filled`;
    if (record.global === 'Yes' && lookupNameEl && !lookupNameEl.value) {
        lookupNameEl.value = record.name;
    }
    const globalPanel = $('#global-panel', formEl);
    if (globalPanel)
        globalPanel.hidden = record.global !== 'Yes';
    const metaStorage = $('.meta-storage', formEl);
    if (metaStorage) {
        metaStorage.textContent = changesLabel();
        metaStorage.title = baseSourceLabel;
    }
}
// ---------------------------------------------------------------------------
// Saving — the API is the source of truth, localStorage is the offline outbox
// ---------------------------------------------------------------------------
function refreshStorageLabels(ok) {
    const metaStorage = $('.meta-storage', formEl);
    if (metaStorage) {
        metaStorage.textContent = ok ? changesLabel() : 'Changes kept in this browser';
        metaStorage.title = baseSourceLabel;
    }
    storageStatusEl.textContent = changesLabel();
    storageStatusEl.title = baseSourceLabel;
}
function persistToBrowser() {
    if (deltaCount(delta) === 0) {
        clearDelta();
        return true;
    }
    return saveDelta(delta);
}
/** Mirror a record the server accepted back into the diff baseline. */
function applyServerRecord(id, map, version) {
    serverRevisions.set(id, version);
    let found = false;
    baseRecords = baseRecords.map((entry) => {
        if (entry.id !== id)
            return entry;
        found = true;
        return map;
    });
    if (!found)
        baseRecords = [...baseRecords, map];
}
async function pushDelta(pending) {
    let saved = 0;
    for (const id of Object.keys(pending.added)) {
        const record = records.find((entry) => entry.id === id);
        if (!record)
            continue;
        let result = await createMapRecord(record);
        if (!result.ok && result.status === 409) {
            // The id already exists on the server — update it instead.
            result = await updateMapRecord(record, serverRevisions.get(id) ?? null);
        }
        if (!result.ok)
            return { ok: false, conflict: result.status === 409, error: result.error, saved };
        applyServerRecord(id, result.data.map, result.data.version);
        saved += 1;
    }
    for (const id of Object.keys(pending.changes)) {
        const record = records.find((entry) => entry.id === id);
        if (!record)
            continue;
        let result = await updateMapRecord(record, serverRevisions.get(id) ?? null);
        if (!result.ok && result.status === 404) {
            // Evicted from the database — recreate it.
            result = await createMapRecord(record);
        }
        if (!result.ok)
            return { ok: false, conflict: result.status === 409, error: result.error, saved };
        applyServerRecord(id, result.data.map, result.data.version);
        saved += 1;
    }
    for (const id of pending.deleted) {
        const result = await deleteMapRecord(id, serverRevisions.get(id) ?? null);
        if (!result.ok && result.status !== 404) {
            return { ok: false, conflict: result.status === 409, error: result.error, saved };
        }
        serverRevisions.delete(id);
        baseRecords = baseRecords.filter((entry) => entry.id !== id);
        saved += 1;
    }
    return { ok: true, conflict: false, saved };
}
async function saveNow(showToast = false) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (saveRunning) {
        saveQueued = true;
        return;
    }
    saveRunning = true;
    try {
        delta = buildDelta(baseRecords, records, baseDataset.updatedAt);
        const count = deltaCount(delta);
        if (!serverMode) {
            const ok = persistToBrowser();
            setSaveStatus(ok ? `Saved ${new Date().toLocaleTimeString()}` : 'Save failed', ok ? 'saved' : 'error');
            renderRecordList();
            updateEditorThumb();
            refreshStorageLabels(ok);
            if (showToast) {
                toast(ok
                    ? count === 0
                        ? 'No changes to save'
                        : `Saved changes for ${count} map${count === 1 ? '' : 's'}`
                    : 'Could not save changes');
            }
            return;
        }
        if (count === 0) {
            clearDelta();
            setSaveStatus(`In sync · ${new Date().toLocaleTimeString()}`, 'saved');
            renderRecordList();
            updateEditorThumb();
            refreshStorageLabels(true);
            if (showToast)
                toast('Everything is already saved');
            return;
        }
        setSaveStatus(`Saving ${count} map${count === 1 ? '' : 's'} to the database…`, 'pending');
        const result = await pushDelta(delta);
        delta = buildDelta(baseRecords, records, baseDataset.updatedAt);
        if (result.ok) {
            const remaining = deltaCount(delta);
            if (remaining === 0)
                clearDelta();
            else
                saveDelta(delta);
            setSaveStatus(`Saved to database · ${new Date().toLocaleTimeString()}`, 'saved');
            renderRecordList();
            updateEditorThumb();
            refreshStorageLabels(true);
            if (showToast && result.saved > 0) {
                toast(`Saved ${result.saved} map${result.saved === 1 ? '' : 's'} to the database`);
            }
            if (remaining > 0)
                saveSoon();
            return;
        }
        // Keep the outbox so nothing is lost while the API is unreachable.
        saveDelta(delta);
        setSaveStatus(result.conflict ? 'Conflict — kept locally' : 'Offline — kept locally', 'error');
        renderRecordList();
        updateEditorThumb();
        refreshStorageLabels(false);
        toast(result.conflict
            ? 'Another editor changed this map. Reload from the server before saving again.'
            : `Could not reach the server (${result.error}). Changes are kept in this browser.`);
    }
    finally {
        saveRunning = false;
        if (saveQueued) {
            saveQueued = false;
            void saveNow();
        }
    }
}
function saveSoon() {
    setSaveStatus('Unsaved changes…', 'pending');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveNow(), serverMode ? 700 : 400);
}
function afterEntryChange(message) {
    const record = current();
    if (record)
        record.updatedAt = new Date().toISOString();
    syncEditorControls();
    updateEditorThumb();
    renderRecordList();
    saveSoon();
    if (message)
        toast(message);
}
// ---------------------------------------------------------------------------
// Record management
// ---------------------------------------------------------------------------
function uniqueId(base, currentId = '') {
    const root = slugify(base) || 'map';
    let candidate = root;
    let counter = 2;
    while (records.some((record) => record.id === candidate && record.id !== currentId)) {
        candidate = `${root}-${counter++}`;
    }
    return candidate;
}
function uniqueName(base) {
    let name = base;
    let counter = 2;
    while (records.some((record) => record.name === name))
        name = `${base}_${counter++}`;
    return name;
}
function selectRecord(id) {
    selectedId = id;
    lookupResults = [];
    renderRecordList();
    renderForm();
    if (palette)
        palette.setCommands(buildEntryCommands());
    trackEditOpen(id);
}
function createRecord() {
    const name = uniqueName('kz_new_map');
    const id = uniqueId(name);
    const record = defaultMapRecord(name, id);
    autoIds.add(id);
    records.unshift(record);
    selectedId = id;
    renderRecordList();
    renderForm();
    saveSoon();
    requestAnimationFrame(() => {
        const input = $('[data-entry-text="name"]', formEl);
        input?.focus();
        input?.select();
    });
    toast('New record created');
    return record;
}
function duplicateRecord() {
    const record = current();
    if (!record)
        return;
    const clone = structuredClone(record);
    clone.name = uniqueName(`${record.name}_copy`);
    clone.id = uniqueId(clone.name);
    clone.updatedAt = new Date().toISOString();
    autoIds.add(clone.id);
    const index = records.indexOf(record);
    records.splice(index + 1, 0, clone);
    selectedId = clone.id;
    renderRecordList();
    renderForm();
    saveSoon();
    toast('Record duplicated');
}
function deleteRecord() {
    const record = current();
    if (!record)
        return;
    if (!window.confirm(`Delete “${record.name}” from the working set?`))
        return;
    records = records.filter((entry) => entry.id !== record.id);
    autoIds.delete(record.id);
    selectedId = records[0]?.id ?? null;
    renderRecordList();
    renderForm();
    saveSoon();
    toast('Record deleted');
}
function updateIdFromName(record, newName) {
    if (!autoIds.has(record.id))
        return;
    const id = uniqueId(newName, record.id);
    autoIds.delete(record.id);
    record.id = id;
    autoIds.add(id);
    if (selectedId !== id)
        selectedId = id;
}
// ---------------------------------------------------------------------------
// cs2kz lookup
// ---------------------------------------------------------------------------
const TIER_NAME_TO_NUMBER = {
    'very-easy': 1,
    easy: 2,
    medium: 3,
    advanced: 4,
    hard: 5,
    'very-hard': 6,
    extreme: 7,
    insane: 8,
    impossible: 9,
};
function tierNumber(value) {
    if (typeof value === 'number' && value >= 1 && value <= 9)
        return Math.round(value);
    if (typeof value !== 'string')
        return null;
    const mapped = TIER_NAME_TO_NUMBER[value.toLowerCase()];
    if (mapped != null)
        return mapped;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 9 ? Math.round(parsed) : null;
}
async function fetchCs2kzMaps(query) {
    const url = `https://api.cs2kz.org/maps?name=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok)
        throw new Error(`cs2kz.org returned HTTP ${response.status}`);
    const data = (await response.json());
    const values = Array.isArray(data.values) ? data.values : [];
    const needle = query.toLowerCase();
    return values.filter((map) => map.name.toLowerCase().includes(needle)).slice(0, 12);
}
async function fetchSteamPreview(workshopId) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `itemcount=1&publishedfileids%5B0%5D=${encodeURIComponent(workshopId)}`,
            signal: controller.signal,
        });
        if (!response.ok)
            return null;
        const data = (await response.json());
        const preview = data.response?.publishedfiledetails?.[0]?.preview_url;
        return typeof preview === 'string' && preview ? preview : null;
    }
    catch {
        return null;
    }
    finally {
        window.clearTimeout(timeout);
    }
}
function renderLookupResults(results) {
    lookupResults = results;
    if (!lookupResultsEl)
        return;
    if (results.length === 0) {
        lookupResultsEl.innerHTML = '';
        return;
    }
    lookupResultsEl.innerHTML = results
        .map((map, mapIndex) => {
        const courses = map.courses ?? [];
        return `<article class="lookup-result">
        <div class="lookup-result-head">
          <div>
            <strong>${escapeHtml(map.name)}</strong>
            <span class="lookup-byline">${escapeHtml(map.mappers?.map((mapper) => mapper.name).join(', ') || 'Unknown mapper')} · ${escapeHtml(map.state ?? 'unknown')}</span>
          </div>
          <a class="link-btn" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(String(map.workshop_id))}" target="_blank" rel="noopener noreferrer">Workshop ↗</a>
        </div>
        <div class="lookup-course-list">
          ${courses.length
            ? courses
                .map((course, courseIndex) => {
                const filters = course.filters?.vanilla ?? course.filters?.classic;
                const tp = tierNumber(filters?.nub_tier);
                const pro = tierNumber(filters?.pro_tier);
                return `<button type="button" class="lookup-course" data-map-index="${mapIndex}" data-course-index="${courseIndex}">
                      <span>${escapeHtml(course.name)}</span>
                      <span class="lookup-tier">TP ${tp ?? '—'} · Pro ${pro ?? '—'}</span>
                    </button>`;
            })
                .join('')
            : `<button type="button" class="lookup-course" data-map-index="${mapIndex}"><span>Use map data</span><span class="lookup-tier">No courses</span></button>`}
        </div>
      </article>`;
    })
        .join('');
}
async function runLookup(query, auto = false) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    const search = query.trim();
    if (!search) {
        setLookupStatus('Type a map name to search cs2kz.org.', 'error');
        return;
    }
    setLookupStatus(`Searching cs2kz.org for “${search}”…`, 'loading');
    if (lookupResultsEl)
        lookupResultsEl.innerHTML = '';
    try {
        const results = await fetchCs2kzMaps(search);
        if (results.length === 0) {
            lookupResults = [];
            setLookupStatus('No global maps matched that name. Keep entering data manually.', 'error');
            return;
        }
        renderLookupResults(results);
        if (auto && results.length === 1) {
            const course = results[0].courses?.find((entry) => entry.name.toLowerCase() === 'main') ?? results[0].courses?.[0];
            applyLookup(results[0], course);
            setLookupStatus(`Auto-filled from cs2kz.org (${results[0].name}). Check the values below.`, 'success');
        }
        else {
            setLookupStatus(`${results.length} match${results.length === 1 ? '' : 'es'} — choose a course to autofill.`, 'success');
        }
    }
    catch (error) {
        setLookupStatus(`Lookup failed: ${error instanceof Error ? error.message : String(error)}. You can still enter data manually.`, 'error');
    }
}
function applyLookup(map, course) {
    const record = current();
    if (!record)
        return;
    record.name = map.name;
    updateIdFromName(record, map.name);
    record.mappers = map.mappers?.map((mapper) => mapper.name).join(', ') ?? record.mappers;
    record.description = (map.description ?? record.description ?? '').trim();
    record.workshopId = map.workshop_id != null ? String(map.workshop_id) : record.workshopId;
    record.cs2kzId = typeof map.id === 'number' ? map.id : record.cs2kzId;
    record.global = 'Yes';
    const filters = course?.filters?.vanilla ?? course?.filters?.classic;
    const tp = tierNumber(filters?.nub_tier);
    const pro = tierNumber(filters?.pro_tier);
    if (tp != null)
        record.tpTier = tp;
    if (pro != null)
        record.proTier = pro;
    record.updatedAt = new Date().toISOString();
    autoIds.delete(record.id);
    syncEditorControls();
    updateEditorThumb();
    renderRecordList();
    saveSoon();
    if (record.workshopId)
        void refreshThumbnail(true);
    toast(course ? `Filled from ${map.name} · ${course.name}` : `Filled from ${map.name}`);
}
async function refreshThumbnail(onlyIfMissing = false) {
    const record = current();
    if (!record?.workshopId) {
        if (!onlyIfMissing)
            toast('Add a Steam Workshop ID first');
        return;
    }
    if (onlyIfMissing && record.thumbnail)
        return;
    setLookupStatus('Fetching thumbnail from Steam…', 'loading');
    const preview = await fetchSteamPreview(record.workshopId);
    if (preview) {
        record.thumbnail = preview;
        record.updatedAt = new Date().toISOString();
        syncEditorControls();
        updateEditorThumb();
        saveSoon();
        setLookupStatus('Thumbnail loaded from Steam.', 'success');
    }
    else if (!onlyIfMissing) {
        setLookupStatus('Steam rejected the browser request (CORS). Paste a thumbnail URL in Meta & media instead.', 'error');
    }
}
function maybeAutoLookup() {
    const record = current();
    if (!record || record.global !== 'Yes')
        return;
    if (!/^kz[_-]/i.test(record.name.trim()))
        return;
    if (record.cs2kzId != null)
        return;
    if (lastAutoLookup === record.name.trim().toLowerCase())
        return;
    lastAutoLookup = record.name.trim().toLowerCase();
    void runLookup(record.name, true);
}
// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------
function exportChanges() {
    delta = buildDelta(baseRecords, records, baseDataset.updatedAt);
    const payload = {
        ...delta,
        changeCount: deltaCount(delta),
        baseSource: baseSourceLabel,
        exportedAt: new Date().toISOString(),
    };
    downloadText('maps_changes.json', `${JSON.stringify(payload, null, 2)}\n`);
    const count = deltaCount(delta);
    toast(count === 0 ? 'No changes to export' : `Exported changes for ${count} map${count === 1 ? '' : 's'}`);
}
function exportAll() {
    const dataset = toDataset(records);
    downloadText('maps.json', datasetToJson(dataset));
    toast('Full maps.json downloaded');
}
function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function exportZip() {
    const dataset = toDataset(records);
    const json = datasetToJson(dataset);
    const blob = await createZip('maps.json', json);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'maps.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    const kb = (blob.size / 1024).toFixed(1);
    toast(`maps.zip downloaded (${kb} KB). Replace public/data/maps.zip and redeploy.`);
}
function applyImportedRecords(importedDelta) {
    delta = importedDelta;
    records = applyDelta(baseRecords, delta);
    selectedId = records[0]?.id ?? null;
    autoIds.clear();
    for (const id of Object.keys(delta.added))
        autoIds.add(id);
    lookupResults = [];
    lastAutoLookup = '';
    renderRecordList();
    renderForm();
    saveNow();
}
async function importFile(file) {
    try {
        const raw = await readJsonFile(file);
        if (isDeltaSet(raw)) {
            if (!window.confirm(`Replace the current saved changes with the changes from ${file.name}?`))
                return;
            const imported = normalizeDelta(raw, baseDataset.updatedAt);
            if (!imported)
                throw new Error('The changes file is not valid.');
            applyImportedRecords(imported);
            toast(`Imported changes for ${deltaCount(imported)} map${deltaCount(imported) === 1 ? '' : 's'}`);
            return;
        }
        if (!window.confirm(`Import ${file.name} as a full change set against the served dataset?`))
            return;
        const imported = normalizeDataset(raw);
        const importedDelta = buildDelta(baseRecords, imported.maps, baseDataset.updatedAt);
        applyImportedRecords(importedDelta);
        toast(`Imported ${imported.maps.length} records as changes`);
    }
    catch (error) {
        toast(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function reloadServed() {
    if (!window.confirm('Discard all unsaved changes and reload from the database? Export your changes first if you need them.')) {
        return;
    }
    try {
        if (serverMode) {
            const snapshot = await fetchSnapshot();
            if (!snapshot)
                throw new Error('The API is unreachable');
            clearDelta();
            baseDataset = snapshot.dataset;
            baseSourceLabel = 'Server API · SQLite';
            baseRecords = snapshot.dataset.maps;
            serverRevisions = new Map(Object.entries(snapshot.revisions ?? {}));
            delta = emptyDelta(baseDataset.updatedAt);
            records = applyDelta(baseRecords, delta);
            selectedId = records[0]?.id ?? null;
            autoIds.clear();
            openedForEdit.clear();
            lookupResults = [];
            lastAutoLookup = '';
            setSaveStatus('Reloaded from the database', 'idle');
            renderRecordList();
            renderForm();
            trackEditOpen(selectedId);
            toast(`Reloaded ${records.length} records from the database`);
            return;
        }
        const served = await loadServedDataset();
        await clearWorkingDataset();
        clearDelta();
        baseDataset = served.dataset;
        baseRecords = served.dataset.maps;
        baseSourceLabel = served.source;
        delta = emptyDelta(baseDataset.updatedAt);
        records = applyDelta(baseRecords, delta);
        selectedId = records[0]?.id ?? null;
        autoIds.clear();
        lookupResults = [];
        lastAutoLookup = '';
        setSaveStatus('Changes discarded', 'idle');
        renderRecordList();
        renderForm();
        toast(`Reloaded ${records.length} records from ${served.source}`);
    }
    catch (error) {
        toast(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// ---------------------------------------------------------------------------
// Quick menu for data entry
// ---------------------------------------------------------------------------
function applyEntryArray(field, value, label) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    const list = getArrayField(record, field);
    const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    setArrayField(record, field, next);
    afterEntryChange(`${label}: ${value} ${list.includes(value) ? 'removed' : 'added'}`);
}
/** Palette version: only adds, so quick entry never accidentally removes a value. */
function addEntryArray(field, value, label) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    const list = getArrayField(record, field);
    if (list.includes(value)) {
        toast(`${label}: ${value} already set`);
        return;
    }
    setArrayField(record, field, [...list, value]);
    afterEntryChange(`${label}: ${value} added`);
}
function applyEntryExclusive(field, value, label) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    setStringField(record, field, value);
    if ((field === 'bhop' || field === 'multi' || field === 'prekeep') && value !== 'Yes') {
        setNullableField(record, `${field}Colour`, null);
    }
    afterEntryChange(`${label}: ${value}`);
    if (field === 'global' && value === 'Yes') {
        updateGlobalPanel();
        maybeAutoLookup();
    }
}
function applyEntryColour(colourField, colour) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    const movement = colourField.replace('Colour', '');
    setStringField(record, movement, 'Yes');
    setNullableField(record, colourField, colour);
    afterEntryChange(`${movement} colour: ${colour}`);
}
function focusEntryField(selector) {
    requestAnimationFrame(() => {
        const field = $(selector);
        if (!field) {
            toast('Field is not visible for this record');
            return;
        }
        field.closest('details')?.setAttribute('open', '');
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field.focus();
        field.select();
    });
}
const entryTri = (field, label) => [
    ...TRI_OPTIONS.map((value) => ({
        id: `${field}:${value}`,
        label: value,
        keywords: value === 'Yes' ? ['y'] : ['n'],
        run: () => applyEntryExclusive(field, value, label),
    })),
    {
        id: `${field}:clear`,
        label: 'Clear selection',
        hint: 'No selection means unknown',
        keywords: ['u', 'unk', 'unknown', 'clear', 'none'],
        run: () => applyEntryExclusive(field, 'Unknown', label),
    },
];
const entryAmounts = (field, label) => AMOUNTS.map((value) => ({
    id: `${field}:${value}`,
    label: value,
    run: () => addEntryArray(field, value, label),
}));
const entryMaterials = (field, label) => MATERIALS.map((value) => ({
    id: `${field}:${value}`,
    label: value,
    run: () => addEntryArray(field, value, label),
}));
function entryTier(field, label, value) {
    const record = current();
    if (!record) {
        toast('Select a map first');
        return;
    }
    setNullableField(record, field, value);
    afterEntryChange(`${label}: ${value ?? 'unset'}`);
}
function buildEntryCommands() {
    return [
        {
            id: 'entry-global',
            label: 'Globalness',
            hint: 'Yes / No',
            keywords: ['glo', 'global'],
            children: entryTri('global', 'Globalness'),
        },
        {
            id: 'entry-materials',
            label: 'Materials',
            hint: 'Toggle a material',
            keywords: ['mat', 'material'],
            children: [
                ...entryMaterials('materials', 'Material'),
                {
                    id: 'entry-brick-colour',
                    label: 'Brick colour',
                    hint: 'Set colour (adds Brick)',
                    keywords: ['brick', 'color', 'colour'],
                    children: COLOURS.map((colour) => ({
                        id: `entry-brickColour:${colour}`,
                        label: colour,
                        run: () => {
                            const record = current();
                            if (!record) {
                                toast('Select a map first');
                                return;
                            }
                            if (!record.materials.includes('Brick'))
                                setArrayField(record, 'materials', [...record.materials, 'Brick']);
                            setNullableField(record, 'brickColour', colour);
                            afterEntryChange(`Brick colour: ${colour}`);
                        },
                    })),
                },
                {
                    id: 'entry-materials-clear',
                    label: 'Clear materials',
                    run: () => {
                        const record = current();
                        if (!record)
                            return;
                        setArrayField(record, 'materials', []);
                        afterEntryChange('Materials cleared');
                    },
                },
            ],
        },
        {
            id: 'entry-props',
            label: 'Props',
            hint: 'None / Some / Lots / All',
            keywords: ['prop'],
            children: entryAmounts('props', 'Props'),
        },
        {
            id: 'entry-top-time',
            label: 'CKZ top time',
            hint: 'Focus the CKZ time field',
            keywords: ['top', 'time', 'ckz', 'classic'],
            keepOpen: false,
            run: () => focusEntryField('[data-entry-top-time]'),
        },
        {
            id: 'entry-vnl-top-time',
            label: 'VNL top time',
            hint: 'Focus the VNL time field',
            keywords: ['top', 'time', 'vnl', 'vanilla'],
            keepOpen: false,
            run: () => focusEntryField('[data-entry-vnl-top-time]'),
        },
        {
            id: 'entry-tp-tier',
            label: 'TP tier',
            hint: '1–9',
            keywords: ['tp', 'tier'],
            children: [
                ...Array.from({ length: 9 }, (_, index) => ({
                    id: `entry-tp:${index + 1}`,
                    label: String(index + 1),
                    run: () => entryTier('tpTier', 'TP tier', index + 1),
                })),
                { id: 'entry-tp:unset', label: 'Unset', run: () => entryTier('tpTier', 'TP tier', null) },
            ],
        },
        {
            id: 'entry-pro-tier',
            label: 'Pro tier',
            hint: '1–9',
            keywords: ['pro', 'tier'],
            children: [
                ...Array.from({ length: 9 }, (_, index) => ({
                    id: `entry-pro:${index + 1}`,
                    label: String(index + 1),
                    run: () => entryTier('proTier', 'Pro tier', index + 1),
                })),
                { id: 'entry-pro:unset', label: 'Unset', run: () => entryTier('proTier', 'Pro tier', null) },
            ],
        },
        {
            id: 'entry-headbangers',
            label: 'Headbangers',
            hint: 'Yes / No',
            keywords: ['headbanger', 'hb'],
            children: entryTri('headbangers', 'Headbangers'),
        },
        {
            id: 'entry-ladders',
            label: 'Ladders',
            hint: 'Amount / construction',
            keywords: ['ladder', 'lad'],
            children: [
                { id: 'entry-ladder-amount', label: 'Amount', children: entryAmounts('ladderAmount', 'Ladder amount') },
                {
                    id: 'entry-ladder-type',
                    label: 'Construction',
                    keywords: ['type', 'ladder type', 'build'],
                    children: LADDER_TYPES.map((value) => ({
                        id: `entry-ladderType:${value}`,
                        label: value,
                        run: () => addEntryArray('ladderTypes', value, 'Ladder type'),
                    })),
                },
            ],
        },
        ...['bhop', 'multi', 'prekeep'].map((field) => ({
            id: `entry-${field}`,
            label: field === 'bhop' ? 'Bhop' : field === 'multi' ? 'Multi' : 'Prekeep',
            hint: 'Yes / No / colour',
            keywords: [field],
            children: [
                ...entryTri(field, field === 'bhop' ? 'Bhop' : field === 'multi' ? 'Multi' : 'Prekeep'),
                {
                    id: `entry-${field}-colour`,
                    label: 'Colour',
                    hint: 'Set colour (implies Yes)',
                    children: COLOURS.map((colour) => ({
                        id: `entry-${field}Colour:${colour}`,
                        label: colour,
                        run: () => applyEntryColour(field === 'bhop' ? 'bhopColour' : field === 'multi' ? 'multiColour' : 'prekeepColour', colour),
                    })),
                },
            ],
        })),
        {
            id: 'entry-surfs',
            label: 'Surfs',
            hint: 'Yes / No / amount / material',
            keywords: ['surf', 'sur'],
            children: [
                {
                    id: 'entry-surfs-yes',
                    label: 'Yes',
                    hint: 'Set amount to Some (adjust below if needed)',
                    keywords: ['y'],
                    run: () => {
                        const record = current();
                        if (!record)
                            return;
                        setArrayField(record, 'surfAmounts', ['Some']);
                        afterEntryChange('Surfs: Yes · Some');
                    },
                },
                { id: 'entry-surfs-no', label: 'No', keywords: ['n'], run: () => { const record = current(); if (!record)
                        return; setArrayField(record, 'surfAmounts', ['None']); afterEntryChange('Surfs: None'); } },
                { id: 'entry-surfs-clear', label: 'Clear selection', keywords: ['u', 'unk', 'unknown', 'clear'], run: () => { const record = current(); if (!record)
                        return; setArrayField(record, 'surfAmounts', []); setArrayField(record, 'surfMaterials', []); afterEntryChange('Surfs cleared'); } },
                { id: 'entry-surf-amount', label: 'Amount', children: entryAmounts('surfAmounts', 'Surf amount') },
                { id: 'entry-surf-material', label: 'Material', children: entryMaterials('surfMaterials', 'Surf material') },
            ],
        },
        {
            id: 'entry-port',
            label: 'Port',
            hint: 'GO / Source / 1.6 / Unknown',
            keywords: ['port'],
            children: PORTS.map((port) => ({
                id: `entry-port:${port}`,
                label: port,
                run: () => {
                    const record = current();
                    if (!record)
                        return;
                    setStringField(record, 'port', port);
                    afterEntryChange(`Port: ${port}`);
                },
            })),
        },
        { id: 'entry-based-on', label: 'Based on', hint: 'Focus the inspiration field', keywords: ['based', 'base'], keepOpen: false, run: () => focusEntryField('[data-entry-text="basedOn"]') },
        {
            id: 'entry-weather',
            label: 'Weather',
            hint: 'Toggle weather',
            keywords: ['wea'],
            children: WEATHER.map((value) => ({ id: `entry-weather:${value}`, label: value, run: () => addEntryArray('weather', value, 'Weather') })),
        },
        {
            id: 'entry-scenery',
            label: 'Scenery',
            hint: 'Setting, biomes, style, hazards…',
            keywords: ['scene', 'scen'],
            children: [
                ...SCENERY_GROUPS.map((group) => ({
                    id: `entry-scenery-group:${group.label}`,
                    label: group.label,
                    hint: `${group.tags.length} tags`,
                    keywords: [group.label.toLowerCase(), 'scenery'],
                    children: group.tags.map((value) => ({
                        id: `entry-scenery-group:${group.label}:${value}`,
                        label: value,
                        run: () => addEntryArray('scenery', value, 'Scenery'),
                    })),
                })),
                // Flat tags keep shortcuts like Scen > Water working.
                ...SCENERY.map((value) => ({
                    id: `entry-scenery:${value}`,
                    label: value,
                    run: () => addEntryArray('scenery', value, 'Scenery'),
                })),
            ],
        },
        {
            id: 'entry-time',
            label: 'Time of day',
            hint: 'Toggle time of day',
            keywords: ['time', 'day', 'night'],
            children: TIMES_OF_DAY.map((value) => ({ id: `entry-time:${value}`, label: value, run: () => addEntryArray('timeOfDay', value, 'Time of day') })),
        },
        {
            id: 'entry-tech',
            label: 'Tech',
            hint: 'Box Tech',
            keywords: ['tech', 'box'],
            children: [
                { id: 'entry-tech:Box Tech', label: 'Box Tech', run: () => addEntryArray('tech', 'Box Tech', 'Tech') },
                { id: 'entry-tech:clear', label: 'Clear tech', run: () => { const record = current(); if (!record)
                        return; setArrayField(record, 'tech', []); afterEntryChange('Tech cleared'); } },
            ],
        },
        {
            id: 'entry-rooms',
            label: 'LJ & ladder rooms',
            hint: 'Rooms and blocks',
            keywords: ['lj', 'room', 'ladder room'],
            children: [
                { id: 'entry-lj-room', label: 'LJ room', children: entryTri('ljRoom', 'LJ room') },
                { id: 'entry-lj-block', label: 'LJ block', children: [...LJ_BLOCK_OPTIONS.map((value) => ({ id: `entry-ljBlock:${value}`, label: value, run: () => applyEntryExclusive('ljBlock', value, 'LJ block') })), { id: 'entry-ljBlock:clear', label: 'Clear selection', keywords: ['u', 'unknown', 'clear'], run: () => applyEntryExclusive('ljBlock', 'Unknown', 'LJ block') }] },
                { id: 'entry-ladder-room', label: 'Ladder room', children: entryTri('ladderRoom', 'Ladder room') },
            ],
        },
        {
            id: 'entry-path',
            label: 'Path',
            hint: 'Toggle route style',
            keywords: ['path', 'route'],
            children: PATHS.map((value) => ({ id: `entry-path:${value}`, label: value, run: () => addEntryArray('path', value, 'Path') })),
        },
        {
            id: 'entry-special',
            label: 'Special blocks',
            hint: 'Toggle special section',
            keywords: ['special', 'blocks'],
            children: SPECIALS.map((value) => ({ id: `entry-special:${value}`, label: value, run: () => addEntryArray('special', value, 'Special') })),
        },
        { id: 'entry-bonus', label: 'Bonus', hint: 'Yes / No', keywords: ['bonus'], children: entryTri('bonus', 'Bonus') },
        {
            id: 'entry-catalogued',
            label: 'Catalogue status',
            hint: 'Catalogued / Uncatalogued',
            keywords: ['catalogue', 'catalogued', 'uncatalogued', 'complete', 'verified'],
            children: [
                ...CATALOGUE_STATES.map((value) => ({
                    id: `entry-catalogued:${value}`,
                    label: value,
                    run: () => applyEntryExclusive('catalogued', value, 'Catalogue'),
                })),
            ],
        },
        { id: 'entry-name', label: 'Map name', hint: 'Focus the name field', keywords: ['name'], keepOpen: false, run: () => focusEntryField('[data-entry-text="name"]') },
        { id: 'entry-mappers', label: 'Mappers', hint: 'Focus the mappers field', keywords: ['mapper'], keepOpen: false, run: () => focusEntryField('[data-entry-text="mappers"]') },
        { id: 'entry-description', label: 'Description', hint: 'Focus the description field', keywords: ['desc'], keepOpen: false, run: () => focusEntryField('[data-entry-text="description"]') },
        { id: 'entry-thumbnail', label: 'Thumbnail URL', hint: 'Focus the thumbnail field', keywords: ['thumb', 'image'], keepOpen: false, run: () => focusEntryField('[data-entry-text="thumbnail"]') },
        { id: 'entry-lookup', label: 'Lookup on cs2kz', hint: 'Search using the current map name', keywords: ['lookup', 'global', 'cs2kz'], keepOpen: false, run: () => { const record = current(); if (!record) {
                toast('Select a map first');
                return;
            } setStringField(record, 'global', 'Yes'); syncEditorControls(); void runLookup(record.name); } },
        { id: 'entry-save', label: 'Save now', hint: 'Persist the working copy', keywords: ['save'], keepOpen: false, run: () => void saveNow(true) },
        { id: 'entry-new', label: 'New map', hint: 'Create a blank record', keywords: ['new', 'add'], keepOpen: false, run: () => void createRecord() },
        { id: 'entry-duplicate', label: 'Duplicate map', hint: 'Copy the selected record', keywords: ['duplicate', 'copy'], keepOpen: false, run: () => duplicateRecord() },
        { id: 'entry-delete', label: 'Delete map', hint: 'Remove the selected record', keywords: ['delete', 'remove'], keepOpen: false, run: () => deleteRecord() },
        { id: 'entry-export-changes', label: 'Export Changes', hint: 'Download only the saved deltas', keywords: ['export', 'changes', 'delta', 'download'], keepOpen: false, run: () => exportChanges() },
        { id: 'entry-export', label: 'Export All ZIP', hint: 'Download the full static dataset', keywords: ['export', 'zip', 'download', 'all'], keepOpen: false, run: () => void exportZip() },
    ];
}
// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------
function bindEvents() {
    recordSearchEl.addEventListener('input', () => {
        recordQuery = recordSearchEl.value;
        renderRecordList();
    });
    recordListEl.addEventListener('click', (event) => {
        const item = event.target.closest('[data-record-id]');
        if (!item)
            return;
        selectRecord(item.dataset.recordId ?? null);
    });
    formEl.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('#lookup-btn')) {
            const record = current();
            if (record)
                void runLookup(lookupNameEl?.value || record.name);
            return;
        }
        const lookupCourse = target.closest('[data-map-index]');
        if (lookupCourse) {
            const map = lookupResults[Number(lookupCourse.dataset.mapIndex)];
            if (map) {
                const courseIndex = lookupCourse.dataset.courseIndex == null ? null : Number(lookupCourse.dataset.courseIndex);
                applyLookup(map, courseIndex == null ? undefined : map.courses?.[courseIndex]);
            }
            return;
        }
        const arrayButton = target.closest('[data-entry-array]');
        if (arrayButton) {
            applyEntryArray(arrayButton.dataset.entryArray ?? '', arrayButton.dataset.value ?? '', 'Property');
            return;
        }
        const exclusiveButton = target.closest('[data-entry-exclusive]');
        if (exclusiveButton) {
            const record = current();
            if (!record)
                return;
            const field = exclusiveButton.dataset.entryExclusive ?? '';
            const value = exclusiveButton.dataset.value ?? '';
            const label = field === 'global' ? 'Globalness' : field;
            const isActive = String(record[field] ?? '') === value;
            // Catalogue status is always one of two states, so clicking the active
            // choice keeps it. Other tri-state chips clear back to Unknown.
            if (field === 'catalogued') {
                if (!isActive)
                    applyEntryExclusive(field, value, 'Catalogue');
                return;
            }
            // Clicking the active choice clears it: empty means Unknown.
            applyEntryExclusive(field, isActive ? 'Unknown' : value, label);
            return;
        }
        if (target.closest('[data-thumb-preview]')) {
            openThumbPreview();
            return;
        }
        if (target.closest('#thumb-fetch')) {
            void refreshThumbnail(false);
            return;
        }
        if (target.closest('#thumb-clear')) {
            const record = current();
            if (!record)
                return;
            record.thumbnail = null;
            record.updatedAt = new Date().toISOString();
            syncEditorControls();
            updateEditorThumb();
            saveSoon();
            toast('Thumbnail removed');
            return;
        }
        if (target.closest('#copy-record')) {
            const record = current();
            if (!record)
                return;
            void navigator.clipboard
                .writeText(JSON.stringify(record, null, 2))
                .then(() => toast('Record JSON copied'))
                .catch(() => toast('Clipboard unavailable'));
        }
    });
    formEl.addEventListener('change', (event) => {
        const target = event.target;
        if (!target.matches('select'))
            return;
        const record = current();
        if (!record)
            return;
        if (target.dataset.entrySelect) {
            const field = target.dataset.entrySelect;
            if (field === 'port') {
                setStringField(record, 'port', target.value);
            }
            else if (field === 'brickColour') {
                setNullableField(record, field, target.value || null);
                if (target.value && !record.materials.includes('Brick')) {
                    setArrayField(record, 'materials', [...record.materials, 'Brick']);
                }
            }
            else if (field === 'bhopColour' || field === 'multiColour' || field === 'prekeepColour') {
                setNullableField(record, field, target.value || null);
                if (target.value)
                    setStringField(record, field.replace('Colour', ''), 'Yes');
            }
            else {
                setStringField(record, field, target.value);
            }
            afterEntryChange();
            return;
        }
        if (target.dataset.entryTier) {
            const field = target.dataset.entryTier;
            record[field] = target.value ? Number(target.value) : null;
            afterEntryChange();
        }
    });
    formEl.addEventListener('input', (event) => {
        const target = event.target;
        const record = current();
        if (!record)
            return;
        const timeInput = target.closest('[data-entry-top-time], [data-entry-vnl-top-time]');
        if (timeInput) {
            const isVnl = timeInput.matches('[data-entry-vnl-top-time]');
            const field = isVnl ? 'vnlTopTime' : 'topTime';
            const hint = $(isVnl ? '[data-vnl-top-time-hint]' : '[data-top-time-hint]', formEl);
            const parsed = parseTopTimeInput(timeInput.value);
            if (!parsed.valid) {
                timeInput.classList.add('invalid');
                if (hint)
                    hint.textContent = 'Use m:ss.xx, h:mm:ss or decimal minutes';
            }
            else {
                timeInput.classList.remove('invalid');
                record[field] = parsed.seconds;
                record.updatedAt = new Date().toISOString();
                if (hint)
                    hint.textContent = parsed.seconds == null ? 'Unknown — leave blank' : formatTopTime(parsed.seconds);
                saveSoon();
            }
            return;
        }
        const text = target.closest('[data-entry-text]');
        if (!text)
            return;
        const field = text.dataset.entryText ?? '';
        if (field === 'name') {
            record.name = text.value;
            updateIdFromName(record, text.value);
            editorHeadingEl.textContent = text.value || 'Untitled map';
            editorSubEl.textContent = `${record.id} · ${completeness(record)}/${COMPLETENESS_TOTAL} properties filled`;
        }
        else if (field === 'cs2kzId') {
            const value = Number(text.value);
            record.cs2kzId = Number.isFinite(value) && text.value.trim() ? value : null;
        }
        else if (field === 'workshopId') {
            record.workshopId = text.value.trim() || null;
        }
        else if (field === 'thumbnail') {
            record.thumbnail = text.value.trim() || null;
            updateEditorThumb();
        }
        else if (field === 'description') {
            record.description = text.value;
        }
        else if (field === 'notes') {
            record.notes = text.value;
        }
        else {
            setStringField(record, field, text.value);
        }
        record.updatedAt = new Date().toISOString();
        renderRecordList();
        saveSoon();
    });
    formEl.addEventListener('focusout', (event) => {
        const target = event.target;
        if (target.matches('[data-entry-top-time], [data-entry-vnl-top-time]')) {
            syncEditorControls();
        }
        if (target.matches('[data-entry-text="name"]')) {
            maybeAutoLookup();
        }
    });
    formEl.addEventListener('keydown', (event) => {
        const target = event.target;
        if (target.matches('#lookup-name') && event.key === 'Enter') {
            event.preventDefault();
            const record = current();
            if (record)
                void runLookup(lookupNameEl?.value || record.name);
        }
    });
    formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveNow(true);
    });
    importFileEl.addEventListener('change', () => {
        const file = importFileEl.files?.[0];
        if (file)
            void importFile(file);
        importFileEl.value = '';
    });
    required('#new-record').addEventListener('click', () => createRecord());
    required('#empty-new-record').addEventListener('click', () => createRecord());
    required('#import-btn').addEventListener('click', () => importFileEl.click());
    required('#export-changes').addEventListener('click', exportChanges);
    required('#export-json').addEventListener('click', exportAll);
    required('#export-zip').addEventListener('click', () => void exportZip());
    required('#reload-served').addEventListener('click', () => void reloadServed());
    required('#duplicate-btn').addEventListener('click', duplicateRecord);
    required('#delete-btn').addEventListener('click', deleteRecord);
    required('#history-btn').addEventListener('click', () => {
        const record = current();
        if (!record) {
            toast('Select a map to see its audit trail');
            return;
        }
        openAuditDialog(record.id, record.name, serverMode);
    });
    required('#save-btn').addEventListener('click', () => void saveNow(true));
    required('#entry-palette-open').addEventListener('click', () => palette.open());
    editorThumbEl.addEventListener('click', openThumbPreview);
    $$('[data-thumb-close]').forEach((element) => element.addEventListener('click', closeThumbPreview));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && thumbModalEl && !thumbModalEl.hidden) {
            closeThumbPreview();
            return;
        }
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && ['p', 'k'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            if (palette.isOpen())
                return;
            palette.open();
            return;
        }
        if (modifier && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void saveNow(true);
            return;
        }
        if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            createRecord();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && saveTimer)
            void saveNow();
    });
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
    setSaveStatus('Loading…');
    // Prefer the API: it is the writable source of truth. Fall back to the
    // static dataset when the site is served without the Node backend.
    let snapshot = null;
    try {
        snapshot = await fetchSnapshot();
    }
    catch {
        snapshot = null;
    }
    let served = null;
    let servedError = null;
    if (snapshot) {
        served = { dataset: snapshot.dataset, source: 'Server API · SQLite' };
    }
    else {
        try {
            served = await loadServedDataset();
        }
        catch (error) {
            servedError = error;
        }
    }
    const legacy = await loadWorkingDataset();
    const storedDelta = loadDelta();
    if (served) {
        baseDataset = served.dataset;
        baseSourceLabel = served.source;
        baseRecords = served.dataset.maps;
        if (snapshot) {
            serverMode = true;
            serverRevisions = new Map(Object.entries(snapshot.revisions ?? {}));
        }
        if (storedDelta) {
            delta = storedDelta;
            if (legacy)
                await clearWorkingDataset();
            if (storedDelta.baseUpdatedAt &&
                storedDelta.baseUpdatedAt !== baseDataset.updatedAt &&
                deltaCount(storedDelta) > 0) {
                window.setTimeout(() => toast('Saved changes were made against an older dataset version. Review them before exporting.'), 500);
            }
        }
        else if (legacy) {
            // Migrate the old full working copy into the new delta format.
            delta = buildMigrationDelta(baseRecords, legacy.maps, baseDataset.updatedAt);
            saveDelta(delta);
            await clearWorkingDataset();
            toast('Migrated the previous browser working copy to delta changes');
        }
        else {
            delta = emptyDelta(baseDataset.updatedAt);
        }
    }
    else if (legacy) {
        // Offline / unavailable served data: keep the legacy copy usable.
        baseDataset = legacy;
        baseSourceLabel = 'Legacy browser copy';
        baseRecords = legacy.maps;
        delta = emptyDelta(baseDataset.updatedAt);
        toast(servedError instanceof Error ? servedError.message : String(servedError));
    }
    else {
        baseDataset = toDataset([]);
        baseSourceLabel = 'No served data';
        baseRecords = [];
        delta = emptyDelta(baseDataset.updatedAt);
        if (servedError)
            toast(servedError instanceof Error ? servedError.message : String(servedError));
    }
    records = applyDelta(baseRecords, delta);
    autoIds.clear();
    for (const id of Object.keys(delta.added))
        autoIds.add(id);
    selectedId = records[0]?.id ?? null;
    palette = new CommandPalette({
        commands: buildEntryCommands(),
        placeholder: 'e.g. Glo > Y   ·   Mat > Con   ·   Bh > Yes   ·   Lad > Type > Rope',
        keepOpenDefault: true,
        showKeepOpenToggle: true,
        ariaLabel: 'Quick data entry menu',
        onClose: () => palette.setCommands(buildEntryCommands()),
    });
    bindEvents();
    bindAuditDialog();
    renderRecordList();
    renderForm();
    trackEditOpen(selectedId);
    const navMeta = $('#nav-mode');
    if (navMeta)
        navMeta.textContent = serverMode ? 'Server database' : 'Local working copy';
    const count = deltaCount(delta);
    setSaveStatus(count
        ? `${count} unsaved map${count === 1 ? '' : 's'} loaded`
        : serverMode
            ? 'Connected to the database'
            : 'Loaded', 'idle');
    if (records.length === 0) {
        createRecord();
    }
}
void boot();
//# sourceMappingURL=entry.js.map