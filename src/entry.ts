import {
  datasetToJson,
  loadServedDataset,
  loadWorkingDataset,
  normalizeDataset,
  readDatasetFile,
  saveWorkingDataset,
  toDataset,
} from './data.js';
import { CommandPalette, type PaletteCommand } from './palette.js';
import {
  AMOUNTS,
  COLOURS,
  LADDER_TYPES,
  LJ_BLOCK_OPTIONS,
  MATERIALS,
  PATHS,
  PORTS,
  SCENERY,
  SPECIALS,
  TIMES_OF_DAY,
  TRI_OPTIONS,
  WEATHER,
  defaultMapRecord,
  type Colour,
  type Cs2kzCourse,
  type Cs2kzLookupMap,
  type MapDataset,
  type MapRecord,
} from './types.js';
import {
  $,
  $$,
  escapeHtml,
  formatTopTime,
  mapInitials,
  matchesAllTokens,
  parseTopTimeInput,
  required,
  slugify,
  thumbStyle,
} from './util.js';
import { createZip } from './zip.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let records: MapRecord[] = [];
let selectedId: string | null = null;
let dataset: MapDataset = { version: 1, updatedAt: new Date().toISOString(), maps: [] };
let recordQuery = '';
let saveTimer: number | undefined;
let palette: CommandPalette;
let lookupResults: Cs2kzLookupMap[] = [];
let lastAutoLookup = '';
let storageLabel = 'Not saved yet';
const autoIds = new Set<string>();

const recordListEl = required<HTMLElement>('#record-list');
const recordSearchEl = required<HTMLInputElement>('#record-search');
const recordCountEl = required<HTMLElement>('#record-count');
const editorHeadingEl = required<HTMLElement>('#editor-heading');
const editorSubEl = required<HTMLElement>('#editor-sub');
const editorThumbEl = required<HTMLElement>('#editor-thumb');
const editorEmptyEl = required<HTMLElement>('#editor-empty');
const formEl = required<HTMLFormElement>('#record-form');
const saveStatusEl = required<HTMLElement>('#save-status');
const storageStatusEl = required<HTMLElement>('#storage-status');
const toastEl = required<HTMLElement>('#toast');
const importFileEl = required<HTMLInputElement>('#import-file');

// Elements inside #record-form are re-created whenever the form re-renders.
let lookupNameEl: HTMLInputElement | null = null;
let lookupStatusEl: HTMLElement | null = null;
let lookupResultsEl: HTMLElement | null = null;

function refreshFormRefs(): void {
  lookupNameEl = $<HTMLInputElement>('#lookup-name', formEl);
  lookupStatusEl = $<HTMLElement>('#lookup-status', formEl);
  lookupResultsEl = $<HTMLElement>('#lookup-results', formEl);
}

let toastTimer: number | undefined;

function toast(message: string): void {
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

function setSaveStatus(text: string, state: 'idle' | 'pending' | 'saved' | 'error' = 'idle'): void {
  saveStatusEl.textContent = text;
  saveStatusEl.dataset.state = state;
}

function current(): MapRecord | undefined {
  return records.find((record) => record.id === selectedId);
}

function getArrayField(record: MapRecord, field: string): string[] {
  const value = (record as unknown as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function setArrayField(record: MapRecord, field: string, values: string[]): void {
  (record as unknown as Record<string, unknown>)[field] = values;
}

function setStringField(record: MapRecord, field: string, value: string): void {
  (record as unknown as Record<string, unknown>)[field] = value;
}

function setNullableField(record: MapRecord, field: string, value: unknown): void {
  (record as unknown as Record<string, unknown>)[field] = value;
}

// ---------------------------------------------------------------------------
// Record list
// ---------------------------------------------------------------------------

function completeness(record: MapRecord): number {
  const checks = [
    record.name.trim().length > 0,
    record.global !== 'Unknown',
    record.materials.length > 0,
    record.props.length > 0,
    record.topTime != null,
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
  ];
  return checks.filter(Boolean).length;
}

const COMPLETENESS_TOTAL = 26;

function renderRecordList(): void {
  const scroll = recordListEl.scrollTop;
  const query = recordQuery.trim();
  const filtered = records
    .filter((record) => {
      if (!query) return true;
      return matchesAllTokens(query, [record.name, record.id, record.mappers, record.basedOn].join(' '));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  recordListEl.innerHTML =
    filtered.length === 0
      ? `<div class="record-list-empty">No records match “${escapeHtml(query)}”.</div>`
      : filtered
          .map((record) => {
            const progress = Math.round((completeness(record) / COMPLETENESS_TOTAL) * 100);
            const state =
              record.global === 'Yes' ? 'Global' : record.global === 'No' ? 'Local' : 'Global?';
            return `<button type="button" class="record-item${record.id === selectedId ? ' active' : ''}" data-record-id="${escapeHtml(
              record.id,
            )}">
              <span class="record-item-top">
                <span class="record-name">${escapeHtml(record.name || 'Untitled map')}</span>
                <span class="record-state ${record.global === 'Yes' ? 'is-global' : ''}">${escapeHtml(state)}</span>
              </span>
              <span class="record-meta">${record.materials.length ? escapeHtml(record.materials.slice(0, 2).join(' · ')) : 'No materials'} <span>·</span> TP ${record.tpTier ?? '—'} / Pro ${record.proTier ?? '—'}</span>
              <span class="record-progress" title="${completeness(record)}/${COMPLETENESS_TOTAL} properties filled"><span style="width:${progress}%"></span></span>
            </button>`;
          })
          .join('');
  recordListEl.scrollTop = scroll;
  const activeItem = recordListEl.querySelector<HTMLElement>('.record-item.active');
  if (activeItem) {
    const listRect = recordListEl.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    if (itemRect.top < listRect.top) recordListEl.scrollTop -= listRect.top - itemRect.top + 4;
    else if (itemRect.bottom > listRect.bottom) recordListEl.scrollTop += itemRect.bottom - listRect.bottom + 4;
  }
  recordCountEl.textContent = `${filtered.length} / ${records.length} records`;
  storageStatusEl.textContent = storageLabel;
}

// ---------------------------------------------------------------------------
// Editor markup
// ---------------------------------------------------------------------------

function chipRow(field: string, label: string, values: readonly string[], mode: 'array' | 'exclusive', hint = ''): string {
  const record = current();
  if (!record) return '';
  const active = mode === 'array' ? getArrayField(record, field) : [];
  const currentValue = String((record as unknown as Record<string, unknown>)[field] ?? '');
  return `<div class="form-group">
    <div class="form-label-row"><span class="form-label">${escapeHtml(label)}</span>${hint ? `<span class="form-hint">${escapeHtml(hint)}</span>` : ''}</div>
    <div class="chip-row" data-entry-group="${field}">
      ${values
        .map((value) => {
          const isActive = mode === 'array' ? active.includes(value) : currentValue === value;
          return `<button type="button" class="chip${isActive ? ' active' : ''}" data-entry-${mode}="${field}" data-value="${escapeHtml(
            value,
          )}" aria-pressed="${isActive}">${escapeHtml(value)}</button>`;
        })
        .join('')}
    </div>
  </div>`;
}

function textField(
  field: string,
  label: string,
  placeholder = '',
  options: { wide?: boolean; maxLength?: number; type?: string } = {},
): string {
  const record = current();
  if (!record) return '';
  const value = String((record as unknown as Record<string, unknown>)[field] ?? '');
  return `<label class="form-field${options.wide ? ' span-2' : ''}">
    <span>${escapeHtml(label)}</span>
    <input type="${options.type ?? 'text'}" data-entry-text="${field}" value="${escapeHtml(value)}"
      placeholder="${escapeHtml(placeholder)}"${options.maxLength ? ` maxlength="${options.maxLength}"` : ''} autocomplete="off" spellcheck="false" />
  </label>`;
}

function selectField(field: string, label: string, values: readonly string[], emptyLabel = ''): string {
  const record = current();
  if (!record) return '';
  const value = String((record as unknown as Record<string, unknown>)[field] ?? '');
  return `<label class="form-field"><span>${escapeHtml(label)}</span><select data-entry-select="${field}">
    ${emptyLabel ? `<option value=""${value === '' ? ' selected' : ''}>${escapeHtml(emptyLabel)}</option>` : ''}
    ${values
      .map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`)
      .join('')}
  </select></label>`;
}

function tierSelect(field: 'tpTier' | 'proTier', label: string): string {
  const record = current();
  if (!record) return '';
  const value = record[field];
  return `<label class="form-field"><span>${escapeHtml(label)}</span><select data-entry-tier="${field}">
    <option value=""${value == null ? ' selected' : ''}>Unset</option>
    ${Array.from({ length: 9 }, (_, index) => index + 1)
      .map((tier) => `<option value="${tier}"${tier === value ? ' selected' : ''}>${tier}</option>`)
      .join('')}
  </select></label>`;
}

function panel(title: string, subtitle: string, body: string, extra = '', id = ''): string {
  return `<section class="form-panel ${extra}"${id ? ` id="${id}"` : ''}>
    <div class="panel-heading">
      <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
    </div>
    ${body}
  </section>`;
}

function renderForm(): void {
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
    ${panel(
      'Identity',
      'The basics. Names beginning with kz_ are picked up by the cs2kz lookup.',
      `<div class="form-grid">
        ${textField('name', 'Map name', 'kz_mapname', { wide: true, maxLength: 100 })}
        ${textField('mappers', 'Mappers', 'ReDMooN, Nova', { maxLength: 255 })}
        ${textField('basedOn', 'Based on', 'Minecraft, Mirror’s Edge…', { maxLength: 255 })}
        <label class="form-field span-2"><span>Description</span><textarea data-entry-text="description" rows="2" maxlength="2000" placeholder="A short description of the map…">${escapeHtml(
          record.description,
        )}</textarea></label>
      </div>
      <div class="form-grid three">
        ${chipRow('global', 'Global-ness', TRI_OPTIONS, 'exclusive', 'Global = cs2kz.org listed')}
        ${chipRow('bonus', 'Bonus map', TRI_OPTIONS, 'exclusive')}
        ${selectField('port', 'Port', PORTS)}
      </div>`,
      'identity-panel',
    )}

    ${panel(
      'Global map lookup',
      'Search the cs2kz.org global map list to autofill name, mappers, tiers, workshop ID and thumbnail.',
      `<div class="lookup-row">
        <input id="lookup-name" class="text-input" type="text" placeholder="kz_grotto" autocomplete="off" spellcheck="false" value="${escapeHtml(
          record.cs2kzId ? '' : record.name,
        )}" />
        <button type="button" class="btn accent" id="lookup-btn">Lookup + autofill</button>
      </div>
      <div id="lookup-status" class="lookup-status"></div>
      <div id="lookup-results" class="lookup-results"></div>`,
      'global-panel',
      'global-panel',
    )}

    ${panel(
      'Ranking & top time',
      'Top time is stored for the main course. Tiers run from 1 (easiest) to 9.',
      `<div class="form-grid three">
        <label class="form-field"><span>Top time</span>
          <input type="text" data-entry-top-time value="${record.topTime == null ? '' : escapeHtml(formatTopTime(record.topTime))}" placeholder="1:23.45 or 1.5 (minutes)" autocomplete="off" spellcheck="false" />
          <span class="form-hint" data-top-time-hint>${record.topTime == null ? 'Unknown — leave blank' : formatTopTime(record.topTime)}</span>
        </label>
        ${tierSelect('tpTier', 'TP tier (nub)')}
        ${tierSelect('proTier', 'Pro tier')}
      </div>`,
    )}

    ${panel(
      'Surfaces & props',
      'Pick every material present. Amounts can be multi-selected because a map can have several prop styles.',
      `<div class="form-grid two">
        ${chipRow('materials', 'Materials', MATERIALS, 'array', 'What is included in the map?')}
        ${chipRow('props', 'Prop blocks', AMOUNTS, 'array')}
      </div>
      <div class="form-grid two">
        ${chipRow('surfAmounts', 'Surf amount', AMOUNTS, 'array')}
        ${chipRow('surfMaterials', 'Surf materials', MATERIALS, 'array')}
      </div>
      <div class="form-grid three movement-grid">
        <div class="surface-card">
          ${chipRow('bhop', 'Bhop', TRI_OPTIONS, 'exclusive')}
          ${selectField('bhopColour', 'Bhop colour', COLOURS, 'Any')}
        </div>
        <div class="surface-card">
          ${chipRow('multi', 'Multi', TRI_OPTIONS, 'exclusive')}
          ${selectField('multiColour', 'Multi colour', COLOURS, 'Any')}
        </div>
        <div class="surface-card">
          ${chipRow('prekeep', 'Prekeep', TRI_OPTIONS, 'exclusive')}
          ${selectField('prekeepColour', 'Prekeep colour', COLOURS, 'Any')}
        </div>
      </div>`,
    )}

    ${panel(
      'Movement & rooms',
      'Ladders, headbangers, long-jump rooms and ladder rooms.',
      `<div class="form-grid two">
        ${chipRow('headbangers', 'Headbangers', TRI_OPTIONS, 'exclusive')}
        ${chipRow('ladderAmount', 'Ladder amount', AMOUNTS, 'array')}
        ${chipRow('ladderTypes', 'Ladder construction', LADDER_TYPES, 'array')}
      </div>
      <div class="form-grid three">
        ${chipRow('ljRoom', 'LJ room', TRI_OPTIONS, 'exclusive')}
        ${chipRow('ljBlock', 'LJ block', LJ_BLOCK_OPTIONS, 'exclusive')}
        ${chipRow('ladderRoom', 'Ladder room', TRI_OPTIONS, 'exclusive')}
      </div>`,
    )}

    ${panel(
      'Route & special blocks',
      'How the route flows and which special movement sections appear.',
      `<div class="form-grid two">
        ${chipRow('path', 'Path', PATHS, 'array')}
        ${chipRow('special', 'Special blocks', SPECIALS, 'array')}
        ${chipRow('tech', 'Tech', ['Box Tech'], 'array')}
      </div>`,
    )}

    ${panel(
      'Scenery, weather & time',
      'What the map looks like and when it takes place.',
      `<div class="form-grid three">
        ${chipRow('scenery', 'Scenery', SCENERY, 'array')}
        ${chipRow('weather', 'Weather', WEATHER, 'array')}
        ${chipRow('timeOfDay', 'Time of day', TIMES_OF_DAY, 'array')}
      </div>`,
    )}

    ${panel(
      'Meta & media',
      'Optional identifiers used by the static database and external links.',
      `<div class="form-grid">
        ${textField('thumbnail', 'Thumbnail URL', 'https://images.steamusercontent.com/…', { wide: true, type: 'url' })}
        ${textField('workshopId', 'Steam Workshop ID', '3121168339')}
        ${textField('cs2kzId', 'cs2kz.org map ID', '2')}
        <label class="form-field span-2"><span>Notes</span><textarea data-entry-text="notes" rows="2" placeholder="Anything worth remembering while entering data…">${escapeHtml(
          record.notes ?? '',
        )}</textarea></label>
      </div>
      <div class="meta-strip">
        <span>Record ID <code>${escapeHtml(record.id)}</code></span>
        <span>Updated <code>${new Date(record.updatedAt).toLocaleString()}</code></span>
        <span class="meta-storage">${escapeHtml(storageLabel)}</span>
      </div>
      <div class="inline-actions">
        <button type="button" class="btn" id="thumb-fetch">Fetch thumbnail from Steam</button>
        <button type="button" class="btn ghost" id="thumb-clear">Remove thumbnail</button>
        <button type="button" class="btn ghost" id="copy-record">Copy record JSON</button>
      </div>`,
    )}
  `;

  refreshFormRefs();
  updateGlobalPanel();
  updateEditorThumb();
  syncEditorControls();
}

function updateEditorThumb(): void {
  const record = current();
  if (!record) return;
  editorThumbEl.setAttribute('style', thumbStyle(record.name));
  if (record.thumbnail) {
    editorThumbEl.innerHTML = `<img src="${escapeHtml(record.thumbnail)}" alt="" referrerpolicy="no-referrer" />`;
    $<HTMLImageElement>('img', editorThumbEl)?.addEventListener('error', () => {
      editorThumbEl.innerHTML = `<span class="editor-thumb-initials">${escapeHtml(mapInitials(record.name))}</span>`;
    });
  } else {
    editorThumbEl.innerHTML = `<span class="editor-thumb-initials">${escapeHtml(mapInitials(record.name))}</span>`;
  }
}

function updateGlobalPanel(): void {
  const record = current();
  const panel = $('#global-panel', formEl);
  if (!record || !panel) return;
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

function setLookupStatus(message: string, state: 'idle' | 'hint' | 'loading' | 'error' | 'success' = 'idle'): void {
  if (!lookupStatusEl) return;
  lookupStatusEl.textContent = message;
  lookupStatusEl.dataset.state = state;
  lookupStatusEl.hidden = !message;
}

function syncEditorControls(): void {
  const record = current();
  if (!record) return;

  $$<HTMLButtonElement>('[data-entry-array]', formEl).forEach((button) => {
    const field = button.dataset.entryArray ?? '';
    const value = button.dataset.value ?? '';
    const active = getArrayField(record, field).includes(value);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  $$<HTMLButtonElement>('[data-entry-exclusive]', formEl).forEach((button) => {
    const field = button.dataset.entryExclusive ?? '';
    const value = button.dataset.value ?? '';
    const active = String((record as unknown as Record<string, unknown>)[field] ?? '') === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  $$<HTMLSelectElement>('[data-entry-select]', formEl).forEach((select) => {
    const field = select.dataset.entrySelect ?? '';
    const value = (record as unknown as Record<string, unknown>)[field];
    select.value = value == null ? '' : String(value);
  });

  $$<HTMLSelectElement>('[data-entry-tier]', formEl).forEach((select) => {
    const field = select.dataset.entryTier as 'tpTier' | 'proTier';
    select.value = record[field] == null ? '' : String(record[field]);
  });

  $$<HTMLInputElement | HTMLTextAreaElement>('[data-entry-text]', formEl).forEach((input) => {
    if (document.activeElement === input) return;
    const field = input.dataset.entryText ?? '';
    const value = (record as unknown as Record<string, unknown>)[field];
    input.value = value == null ? '' : String(value);
  });

  const topTimeInput = $<HTMLInputElement>('[data-entry-top-time]', formEl);
  if (topTimeInput && document.activeElement !== topTimeInput) {
    topTimeInput.value = record.topTime == null ? '' : formatTopTime(record.topTime);
    topTimeInput.classList.remove('invalid');
  }

  editorHeadingEl.textContent = record.name || 'Untitled map';
  editorSubEl.textContent = `${record.id} · ${completeness(record)}/${COMPLETENESS_TOTAL} properties filled`;
  if (record.global === 'Yes' && lookupNameEl && !lookupNameEl.value) {
    lookupNameEl.value = record.name;
  }
  const globalPanel = $('#global-panel', formEl);
  if (globalPanel) globalPanel.hidden = record.global !== 'Yes';
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

async function saveNow(showToast = false): Promise<void> {
  window.clearTimeout(saveTimer);
  const record = current();
  if (record) record.updatedAt = new Date().toISOString();
  dataset = toDataset(records);
  const ok = await saveWorkingDataset(dataset);
  storageLabel = ok ? 'Working copy saved in this browser' : 'Could not save — export a backup';
  setSaveStatus(ok ? `Saved ${new Date().toLocaleTimeString()}` : 'Save failed', ok ? 'saved' : 'error');
  renderRecordList();
  updateEditorThumb();
  if (showToast) toast(ok ? 'Working copy saved' : 'Could not save working copy');
}

function saveSoon(): void {
  setSaveStatus('Unsaved changes…', 'pending');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveNow();
  }, 600);
}

function afterEntryChange(message?: string): void {
  syncEditorControls();
  updateEditorThumb();
  renderRecordList();
  saveSoon();
  if (message) toast(message);
}

// ---------------------------------------------------------------------------
// Record management
// ---------------------------------------------------------------------------

function uniqueId(base: string, currentId = ''): string {
  const root = slugify(base) || 'map';
  let candidate = root;
  let counter = 2;
  while (records.some((record) => record.id === candidate && record.id !== currentId)) {
    candidate = `${root}-${counter++}`;
  }
  return candidate;
}

function uniqueName(base: string): string {
  let name = base;
  let counter = 2;
  while (records.some((record) => record.name === name)) name = `${base}_${counter++}`;
  return name;
}

function selectRecord(id: string | null): void {
  selectedId = id;
  lookupResults = [];
  renderRecordList();
  renderForm();
  if (palette) palette.setCommands(buildEntryCommands());
}

function createRecord(): MapRecord {
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
    const input = $<HTMLInputElement>('[data-entry-text="name"]', formEl);
    input?.focus();
    input?.select();
  });
  toast('New record created');
  return record;
}

function duplicateRecord(): void {
  const record = current();
  if (!record) return;
  const clone: MapRecord = structuredClone(record);
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

function deleteRecord(): void {
  const record = current();
  if (!record) return;
  if (!window.confirm(`Delete “${record.name}” from the working set?`)) return;
  records = records.filter((entry) => entry.id !== record.id);
  autoIds.delete(record.id);
  selectedId = records[0]?.id ?? null;
  renderRecordList();
  renderForm();
  saveSoon();
  toast('Record deleted');
}

function updateIdFromName(record: MapRecord, newName: string): void {
  if (!autoIds.has(record.id)) return;
  const id = uniqueId(newName, record.id);
  autoIds.delete(record.id);
  record.id = id;
  autoIds.add(id);
  if (selectedId !== id) selectedId = id;
}

// ---------------------------------------------------------------------------
// cs2kz lookup
// ---------------------------------------------------------------------------

const TIER_NAME_TO_NUMBER: Record<string, number> = {
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

function tierNumber(value: unknown): number | null {
  if (typeof value === 'number' && value >= 1 && value <= 9) return Math.round(value);
  if (typeof value !== 'string') return null;
  const mapped = TIER_NAME_TO_NUMBER[value.toLowerCase()];
  if (mapped != null) return mapped;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 9 ? Math.round(parsed) : null;
}

async function fetchCs2kzMaps(query: string): Promise<Cs2kzLookupMap[]> {
  const url = `https://api.cs2kz.org/maps?name=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`cs2kz.org returned HTTP ${response.status}`);
  const data = (await response.json()) as { values?: Cs2kzLookupMap[] };
  const values = Array.isArray(data.values) ? data.values : [];
  const needle = query.toLowerCase();
  return values.filter((map) => map.name.toLowerCase().includes(needle)).slice(0, 12);
}

async function fetchSteamPreview(workshopId: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids%5B0%5D=${encodeURIComponent(workshopId)}`,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      response?: { publishedfiledetails?: { preview_url?: string }[] };
    };
    const preview = data.response?.publishedfiledetails?.[0]?.preview_url;
    return typeof preview === 'string' && preview ? preview : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderLookupResults(results: Cs2kzLookupMap[]): void {
  lookupResults = results;
  if (!lookupResultsEl) return;
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
            <span class="lookup-byline">${escapeHtml(map.mappers?.map((mapper) => mapper.name).join(', ') || 'Unknown mapper')} · ${escapeHtml(
              map.state ?? 'unknown',
            )}</span>
          </div>
          <a class="link-btn" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(
            String(map.workshop_id),
          )}" target="_blank" rel="noopener noreferrer">Workshop ↗</a>
        </div>
        <div class="lookup-course-list">
          ${
            courses.length
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
              : `<button type="button" class="lookup-course" data-map-index="${mapIndex}"><span>Use map data</span><span class="lookup-tier">No courses</span></button>`
          }
        </div>
      </article>`;
    })
    .join('');
}

async function runLookup(query: string, auto = false): Promise<void> {
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
  if (lookupResultsEl) lookupResultsEl.innerHTML = '';
  try {
    const results = await fetchCs2kzMaps(search);
    if (results.length === 0) {
      lookupResults = [];
      setLookupStatus('No global maps matched that name. Keep entering data manually.', 'error');
      return;
    }
    renderLookupResults(results);
    if (auto && results.length === 1) {
      const course =
        results[0].courses?.find((entry) => entry.name.toLowerCase() === 'main') ?? results[0].courses?.[0];
      applyLookup(results[0], course);
      setLookupStatus(`Auto-filled from cs2kz.org (${results[0].name}). Check the values below.`, 'success');
    } else {
      setLookupStatus(`${results.length} match${results.length === 1 ? '' : 'es'} — choose a course to autofill.`, 'success');
    }
  } catch (error) {
    setLookupStatus(
      `Lookup failed: ${error instanceof Error ? error.message : String(error)}. You can still enter data manually.`,
      'error',
    );
  }
}

function applyLookup(map: Cs2kzLookupMap, course?: Cs2kzCourse): void {
  const record = current();
  if (!record) return;
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
  if (tp != null) record.tpTier = tp;
  if (pro != null) record.proTier = pro;
  record.updatedAt = new Date().toISOString();
  autoIds.delete(record.id);
  syncEditorControls();
  updateEditorThumb();
  renderRecordList();
  saveSoon();
  if (record.workshopId) void refreshThumbnail(true);
  toast(course ? `Filled from ${map.name} · ${course.name}` : `Filled from ${map.name}`);
}

async function refreshThumbnail(onlyIfMissing = false): Promise<void> {
  const record = current();
  if (!record?.workshopId) {
    if (!onlyIfMissing) toast('Add a Steam Workshop ID first');
    return;
  }
  if (onlyIfMissing && record.thumbnail) return;
  setLookupStatus('Fetching thumbnail from Steam…', 'loading');
  const preview = await fetchSteamPreview(record.workshopId);
  if (preview) {
    record.thumbnail = preview;
    syncEditorControls();
    updateEditorThumb();
    saveSoon();
    setLookupStatus('Thumbnail loaded from Steam.', 'success');
  } else if (!onlyIfMissing) {
    setLookupStatus(
      'Steam rejected the browser request (CORS). Paste a thumbnail URL in Meta & media instead.',
      'error',
    );
  }
}

function maybeAutoLookup(): void {
  const record = current();
  if (!record || record.global !== 'Yes') return;
  if (!/^kz[_-]/i.test(record.name.trim())) return;
  if (record.cs2kzId != null) return;
  if (lastAutoLookup === record.name.trim().toLowerCase()) return;
  lastAutoLookup = record.name.trim().toLowerCase();
  void runLookup(record.name, true);
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

function exportJson(): void {
  dataset = toDataset(records);
  const json = datasetToJson(dataset);
  downloadText('maps.json', json);
  toast('maps.json downloaded');
}

function downloadText(filename: string, text: string): void {
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

async function exportZip(): Promise<void> {
  dataset = toDataset(records);
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

async function importFile(file: File): Promise<void> {
  try {
    const imported = normalizeDataset(await readDatasetFile(file));
    if (
      !window.confirm(
        `Replace the current working set (${records.length} records) with the imported dataset (${imported.maps.length} records)?`,
      )
    ) {
      return;
    }
    dataset = imported;
    records = imported.maps;
    selectedId = records[0]?.id ?? null;
    autoIds.clear();
    lookupResults = [];
    lastAutoLookup = '';
    storageLabel = `Imported ${file.name}`;
    renderRecordList();
    renderForm();
    await saveNow();
    toast(`Imported ${records.length} records from ${file.name}`);
  } catch (error) {
    toast(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reloadServed(): Promise<void> {
  if (
    !window.confirm(
      'Discard the browser working copy and reload public/data/maps.zip? Export first if you have unsaved records.',
    )
  ) {
    return;
  }
  try {
    const served = await loadServedDataset();
    dataset = served.dataset;
    records = served.dataset.maps;
    selectedId = records[0]?.id ?? null;
    autoIds.clear();
    lookupResults = [];
    lastAutoLookup = '';
    storageLabel = `Loaded ${served.source}`;
    renderRecordList();
    renderForm();
    await saveNow();
    toast(`Reloaded ${records.length} records from ${served.source}`);
  } catch (error) {
    toast(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Quick menu for data entry
// ---------------------------------------------------------------------------

function applyEntryArray(field: string, value: string, label: string): void {
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
function addEntryArray(field: string, value: string, label: string): void {
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

function applyEntryExclusive(field: string, value: string, label: string): void {
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

function applyEntryColour(colourField: 'bhopColour' | 'multiColour' | 'prekeepColour', colour: Colour): void {
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

function focusEntryField(selector: string): void {
  requestAnimationFrame(() => {
    const field = $<HTMLInputElement | HTMLTextAreaElement>(selector);
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

const entryTri = (field: string, label: string): PaletteCommand[] =>
  TRI_OPTIONS.map((value) => ({
    id: `${field}:${value}`,
    label: value,
    keywords: value === 'Yes' ? ['y'] : value === 'No' ? ['n'] : ['u'],
    run: () => applyEntryExclusive(field, value, label),
  }));

const entryAmounts = (field: string, label: string): PaletteCommand[] =>
  AMOUNTS.map((value) => ({
    id: `${field}:${value}`,
    label: value,
    run: () => addEntryArray(field, value, label),
  }));

const entryMaterials = (field: string, label: string): PaletteCommand[] =>
  MATERIALS.map((value) => ({
    id: `${field}:${value}`,
    label: value,
    run: () => addEntryArray(field, value, label),
  }));

function entryTier(field: 'tpTier' | 'proTier', label: string, value: number | null): void {
  const record = current();
  if (!record) {
    toast('Select a map first');
    return;
  }
  setNullableField(record, field, value);
  afterEntryChange(`${label}: ${value ?? 'unset'}`);
}

function buildEntryCommands(): PaletteCommand[] {
  return [
    {
      id: 'entry-global',
      label: 'Globalness',
      hint: 'Yes / No / Unknown',
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
          id: 'entry-materials-clear',
          label: 'Clear materials',
          run: () => {
            const record = current();
            if (!record) return;
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
      label: 'Top time',
      hint: 'Focus the time field',
      keywords: ['top', 'time'],
      keepOpen: false,
      run: () => focusEntryField('[data-entry-top-time]'),
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
      hint: 'Yes / No / Unknown',
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
    ...(['bhop', 'multi', 'prekeep'] as const).map((field) => ({
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
            run: () =>
              applyEntryColour(
                field === 'bhop' ? 'bhopColour' : field === 'multi' ? 'multiColour' : 'prekeepColour',
                colour,
              ),
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
            if (!record) return;
            setArrayField(record, 'surfAmounts', ['Some']);
            afterEntryChange('Surfs: Yes · Some');
          },
        },
        { id: 'entry-surfs-no', label: 'No', keywords: ['n'], run: () => { const record = current(); if (!record) return; setArrayField(record, 'surfAmounts', ['None']); afterEntryChange('Surfs: None'); } },
        { id: 'entry-surfs-unknown', label: 'Unknown', keywords: ['u'], run: () => { const record = current(); if (!record) return; setArrayField(record, 'surfAmounts', ['Unknown']); afterEntryChange('Surfs: Unknown'); } },
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
          if (!record) return;
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
      hint: 'Toggle scenery',
      keywords: ['scene', 'scen'],
      children: SCENERY.map((value) => ({ id: `entry-scenery:${value}`, label: value, run: () => addEntryArray('scenery', value, 'Scenery') })),
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
        { id: 'entry-tech:clear', label: 'Clear tech', run: () => { const record = current(); if (!record) return; setArrayField(record, 'tech', []); afterEntryChange('Tech cleared'); } },
      ],
    },
    {
      id: 'entry-rooms',
      label: 'LJ & ladder rooms',
      hint: 'Rooms and blocks',
      keywords: ['lj', 'room', 'ladder room'],
      children: [
        { id: 'entry-lj-room', label: 'LJ room', children: entryTri('ljRoom', 'LJ room') },
        { id: 'entry-lj-block', label: 'LJ block', children: LJ_BLOCK_OPTIONS.map((value) => ({ id: `entry-ljBlock:${value}`, label: value, run: () => applyEntryExclusive('ljBlock', value, 'LJ block') })) },
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
    { id: 'entry-bonus', label: 'Bonus', hint: 'Yes / No / Unknown', keywords: ['bonus'], children: entryTri('bonus', 'Bonus') },
    { id: 'entry-name', label: 'Map name', hint: 'Focus the name field', keywords: ['name'], keepOpen: false, run: () => focusEntryField('[data-entry-text="name"]') },
    { id: 'entry-mappers', label: 'Mappers', hint: 'Focus the mappers field', keywords: ['mapper'], keepOpen: false, run: () => focusEntryField('[data-entry-text="mappers"]') },
    { id: 'entry-description', label: 'Description', hint: 'Focus the description field', keywords: ['desc'], keepOpen: false, run: () => focusEntryField('[data-entry-text="description"]') },
    { id: 'entry-thumbnail', label: 'Thumbnail URL', hint: 'Focus the thumbnail field', keywords: ['thumb', 'image'], keepOpen: false, run: () => focusEntryField('[data-entry-text="thumbnail"]') },
    { id: 'entry-lookup', label: 'Lookup on cs2kz', hint: 'Search using the current map name', keywords: ['lookup', 'global', 'cs2kz'], keepOpen: false, run: () => { const record = current(); if (!record) { toast('Select a map first'); return; } setStringField(record, 'global', 'Yes'); syncEditorControls(); void runLookup(record.name); } },
    { id: 'entry-save', label: 'Save now', hint: 'Persist the working copy', keywords: ['save'], keepOpen: false, run: () => void saveNow(true) },
    { id: 'entry-new', label: 'New map', hint: 'Create a blank record', keywords: ['new', 'add'], keepOpen: false, run: () => void createRecord() },
    { id: 'entry-duplicate', label: 'Duplicate map', hint: 'Copy the selected record', keywords: ['duplicate', 'copy'], keepOpen: false, run: () => duplicateRecord() },
    { id: 'entry-delete', label: 'Delete map', hint: 'Remove the selected record', keywords: ['delete', 'remove'], keepOpen: false, run: () => deleteRecord() },
    { id: 'entry-export', label: 'Export maps.zip', hint: 'Download the static dataset', keywords: ['export', 'zip', 'download'], keepOpen: false, run: () => void exportZip() },
  ];
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function bindEvents(): void {
  recordSearchEl.addEventListener('input', () => {
    recordQuery = recordSearchEl.value;
    renderRecordList();
  });

  recordListEl.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-record-id]');
    if (!item) return;
    selectRecord(item.dataset.recordId ?? null);
  });

  formEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('#lookup-btn')) {
      const record = current();
      if (record) void runLookup(lookupNameEl?.value || record.name);
      return;
    }

    const lookupCourse = target.closest<HTMLButtonElement>('[data-map-index]');
    if (lookupCourse) {
      const map = lookupResults[Number(lookupCourse.dataset.mapIndex)];
      if (map) {
        const courseIndex = lookupCourse.dataset.courseIndex == null ? null : Number(lookupCourse.dataset.courseIndex);
        applyLookup(map, courseIndex == null ? undefined : map.courses?.[courseIndex]);
      }
      return;
    }

    const arrayButton = target.closest<HTMLButtonElement>('[data-entry-array]');
    if (arrayButton) {
      applyEntryArray(arrayButton.dataset.entryArray ?? '', arrayButton.dataset.value ?? '', 'Property');
      return;
    }

    const exclusiveButton = target.closest<HTMLButtonElement>('[data-entry-exclusive]');
    if (exclusiveButton) {
      const field = exclusiveButton.dataset.entryExclusive ?? '';
      applyEntryExclusive(field, exclusiveButton.dataset.value ?? '', field === 'global' ? 'Globalness' : field);
      return;
    }

    if (target.closest('#thumb-fetch')) {
      void refreshThumbnail(false);
      return;
    }
    if (target.closest('#thumb-clear')) {
      const record = current();
      if (!record) return;
      record.thumbnail = null;
      syncEditorControls();
      updateEditorThumb();
      saveSoon();
      toast('Thumbnail removed');
      return;
    }
    if (target.closest('#copy-record')) {
      const record = current();
      if (!record) return;
      void navigator.clipboard
        .writeText(JSON.stringify(record, null, 2))
        .then(() => toast('Record JSON copied'))
        .catch(() => toast('Clipboard unavailable'));
    }
  });

  formEl.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    if (!target.matches('select')) return;
    const record = current();
    if (!record) return;

    if (target.dataset.entrySelect) {
      const field = target.dataset.entrySelect;
      if (field === 'port') {
        setStringField(record, 'port', target.value);
      } else if (field === 'bhopColour' || field === 'multiColour' || field === 'prekeepColour') {
        setNullableField(record, field, target.value || null);
        if (target.value) setStringField(record, field.replace('Colour', ''), 'Yes');
      } else {
        setStringField(record, field, target.value);
      }
      afterEntryChange();
      return;
    }

    if (target.dataset.entryTier) {
      const field = target.dataset.entryTier as 'tpTier' | 'proTier';
      record[field] = target.value ? Number(target.value) : null;
      afterEntryChange();
    }
  });

  formEl.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    const record = current();
    if (!record) return;

    if (target.matches('[data-entry-top-time]')) {
      const input = target as HTMLInputElement;
      const parsed = parseTopTimeInput(input.value);
      const hint = $<HTMLElement>('[data-top-time-hint]', formEl);
      if (!parsed.valid) {
        input.classList.add('invalid');
        if (hint) hint.textContent = 'Use m:ss.xx or decimal minutes';
      } else {
        input.classList.remove('invalid');
        record.topTime = parsed.seconds;
        if (hint) hint.textContent = parsed.seconds == null ? 'Unknown — leave blank' : formatTopTime(parsed.seconds);
        saveSoon();
      }
      return;
    }

    const text = target.closest<HTMLInputElement | HTMLTextAreaElement>('[data-entry-text]');
    if (!text) return;
    const field = text.dataset.entryText ?? '';

    if (field === 'name') {
      record.name = text.value;
      updateIdFromName(record, text.value);
      editorHeadingEl.textContent = text.value || 'Untitled map';
      editorSubEl.textContent = `${record.id} · ${completeness(record)}/${COMPLETENESS_TOTAL} properties filled`;
    } else if (field === 'cs2kzId') {
      const value = Number(text.value);
      record.cs2kzId = Number.isFinite(value) && text.value.trim() ? value : null;
    } else if (field === 'workshopId') {
      record.workshopId = text.value.trim() || null;
    } else if (field === 'thumbnail') {
      record.thumbnail = text.value.trim() || null;
      updateEditorThumb();
    } else if (field === 'description') {
      record.description = text.value;
    } else if (field === 'notes') {
      record.notes = text.value;
    } else {
      setStringField(record, field, text.value);
    }
    renderRecordList();
    saveSoon();
  });

  formEl.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-entry-top-time]')) {
      syncEditorControls();
    }
    if (target.matches('[data-entry-text="name"]')) {
      maybeAutoLookup();
    }
  });

  formEl.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('#lookup-name') && event.key === 'Enter') {
      event.preventDefault();
      const record = current();
      if (record) void runLookup(lookupNameEl?.value || record.name);
    }
  });

  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveNow(true);
  });

  importFileEl.addEventListener('change', () => {
    const file = importFileEl.files?.[0];
    if (file) void importFile(file);
    importFileEl.value = '';
  });

  required<HTMLButtonElement>('#new-record').addEventListener('click', () => createRecord());
  required<HTMLButtonElement>('#empty-new-record').addEventListener('click', () => createRecord());
  required<HTMLButtonElement>('#import-btn').addEventListener('click', () => importFileEl.click());
  required<HTMLButtonElement>('#export-json').addEventListener('click', exportJson);
  required<HTMLButtonElement>('#export-zip').addEventListener('click', () => void exportZip());
  required<HTMLButtonElement>('#reload-served').addEventListener('click', () => void reloadServed());
  required<HTMLButtonElement>('#duplicate-btn').addEventListener('click', duplicateRecord);
  required<HTMLButtonElement>('#delete-btn').addEventListener('click', deleteRecord);
  required<HTMLButtonElement>('#save-btn').addEventListener('click', () => void saveNow(true));
  required<HTMLButtonElement>('#entry-palette-open').addEventListener('click', () => palette.open());

  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && ['p', 'k'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (palette.isOpen()) return;
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
    if (document.visibilityState === 'hidden' && saveTimer) void saveNow();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  setSaveStatus('Loading…');
  const working = await loadWorkingDataset();
  if (working) {
    dataset = working;
    records = working.maps;
    storageLabel = 'Loaded browser working copy';
  } else {
    try {
      const served = await loadServedDataset();
      dataset = served.dataset;
      records = served.dataset.maps;
      storageLabel = `Loaded ${served.source}`;
    } catch (error) {
      dataset = toDataset([]);
      records = [];
      storageLabel = 'No data found — starting empty';
      toast(error instanceof Error ? error.message : String(error));
    }
  }

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
  renderRecordList();
  renderForm();
  setSaveStatus(storageLabel, 'idle');

  if (records.length === 0) {
    createRecord();
  }
}

void boot();
