import { loadServedDataset } from './data.js';
import { activeFilterChips, clearFilters, countActiveFilters, filterMaps, removeFilterChip, sortMaps, } from './filters.js';
import { CommandPalette } from './palette.js';
import { AMOUNTS, COLOURS, DEFAULT_FILTERS, LADDER_TYPES, LJ_BLOCK_OPTIONS, MATERIALS, PATHS, PORTS, SCENERY, SORT_OPTIONS, SPECIALS, TIMES_OF_DAY, TOP_TIME_PRESETS, TRI_OPTIONS, WEATHER, } from './types.js';
import { $, $$, decodeState, encodeState, escapeHtml, formatRange, formatTopTime, mapInitials, required, slugify, thumbStyle, } from './util.js';
const PAGE_SIZE = 24;
const TOP_RANGE_MAX = 30;
let maps = [];
let mapById = new Map();
let filters = structuredClone(DEFAULT_FILTERS);
let sort = 'name';
let limit = PAGE_SIZE;
let loaded = false;
let palette;
const filtersEl = required('#filters');
const gridEl = required('#map-grid');
const emptyEl = required('#empty-state');
const loadMoreEl = required('#load-more');
const resultCountEl = required('#result-count');
const activeEl = required('#active-filters');
const nameSearchEl = required('#name-search');
const sortEl = required('#sort');
const datasetMetaEl = required('#dataset-meta');
const toastEl = required('#toast');
const modalEl = required('#map-modal');
const modalContentEl = required('#modal-content');
const filtersToggleEl = required('#filters-toggle');
const filtersBackdropEl = required('#filters-backdrop');
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
    }, 2200);
}
// ---------------------------------------------------------------------------
// Sidebar markup
// ---------------------------------------------------------------------------
const chipGroup = (key, values) => `<div class="chip-grid" data-group="${key}">${values
    .map((value) => `<button type="button" class="chip" data-toggle="${key}" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(value)}</button>`)
    .join('')}</div>`;
const amountGroup = (key) => chipGroup(key, AMOUNTS);
const section = (title, body, description = '', open = false) => `<details class="filter-section"${open ? ' open' : ''}>
    <summary><span>${escapeHtml(title)}</span><span class="summary-mark" aria-hidden="true"></span></summary>
    ${description ? `<p class="filter-desc">${escapeHtml(description)}</p>` : ''}
    <div class="filter-body">${body}</div>
  </details>`;
const colourSelect = (key, label = 'Colour') => `<label class="field-inline"><span>${label}</span><select data-select="${key}">
    <option value="">Any</option>
    ${COLOURS.map((colour) => `<option value="${escapeHtml(colour)}">${escapeHtml(colour)}</option>`).join('')}
  </select></label>`;
const tierSelects = (prefix, label) => `<div class="tier-row">
    <span class="field-label">${label}</span>
    <label class="field-inline compact"><span>Min</span><select data-tier="${prefix}" data-bound="min">
      <option value="">Any</option>${Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
    </select></label>
    <label class="field-inline compact"><span>Max</span><select data-tier="${prefix}" data-bound="max">
      <option value="">Any</option>${Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
    </select></label>
  </div>`;
function buildSidebar() {
    filtersEl.innerHTML = `
    <div class="filters-head">
      <div class="filters-title-wrap">
        <span class="filters-title">Filters</span>
        <span class="filters-count" id="filter-count">0</span>
      </div>
      <div class="filters-head-actions">
        <button type="button" class="link-btn" id="clear-filters-side">Clear all</button>
        <button type="button" class="icon-btn filters-close" id="filters-close" aria-label="Close filters">×</button>
      </div>
    </div>

    ${section('Global-ness', chipGroup('global', TRI_OPTIONS), 'Is the map on the global list?', true)}
    ${section('Material-ness', `${chipGroup('materials', MATERIALS)}
       <div class="mode-row">
         <span class="field-label">Match</span>
         <div class="segmented" data-mode="materials">
           <button type="button" data-mode-value="all">All of</button>
           <button type="button" data-mode-value="any">Any of</button>
         </div>
       </div>`, 'Which materials are included?', true)}
    ${section('Props', amountGroup('props'), 'Are there prop blocks?', true)}
    ${section('Top time', `<div class="preset-row">${TOP_TIME_PRESETS.map((preset, index) => `<button type="button" class="chip chip-sm" data-top-preset="${index}">${escapeHtml(preset.label)}</button>`).join('')}</div>
       <div class="range-control" data-range="top">
         <div class="range-track"><div class="range-fill" data-range-fill></div></div>
         <input class="range-input range-min" type="range" min="0" max="${TOP_RANGE_MAX}" step="1" value="0" data-range-min aria-label="Minimum top time in minutes" />
         <input class="range-input range-max" type="range" min="0" max="${TOP_RANGE_MAX}" step="1" value="${TOP_RANGE_MAX}" data-range-max aria-label="Maximum top time in minutes" />
       </div>
       <div class="range-readout"><span data-top-readout>Any duration</span><button type="button" class="link-btn" data-clear-top>Reset</button></div>`, 'Fastest completion time, in minutes.', true)}
    ${section('Tiers', `${tierSelects('tp', 'TP tier')}<div class="tier-gap"></div>${tierSelects('pro', 'Pro tier')}`, '1–9 difficulty tiers.', true)}
    ${section('Headbangers', chipGroup('headbangers', TRI_OPTIONS))}
    ${section('Ladders', `<div class="sub-group"><span class="field-label">Amount</span>${amountGroup('ladderAmount')}</div>
       <div class="sub-group"><span class="field-label">Construction</span>${chipGroup('ladderTypes', LADDER_TYPES)}</div>`, 'How many ladders, and how are they built?')}
    ${section('Bhop', `${chipGroup('bhop', TRI_OPTIONS)}${colourSelect('bhopColour', 'Surface colour')}`, 'Bhop surfaces present?', true)}
    ${section('Multi', `${chipGroup('multi', TRI_OPTIONS)}${colourSelect('multiColour', 'Surface colour')}`)}
    ${section('Prekeep', `${chipGroup('prekeep', TRI_OPTIONS)}${colourSelect('prekeepColour', 'Surface colour')}`)}
    ${section('Surfs', `<div class="sub-group"><span class="field-label">Amount</span>${amountGroup('surfAmounts')}</div>
       <div class="sub-group"><span class="field-label">Material</span>${chipGroup('surfMaterials', MATERIALS)}</div>`, 'Surf ramps and their surface material.')}
    ${section('Port', chipGroup('ports', PORTS), 'Ported from an older game?')}
    ${section('Based on', `<input type="text" class="text-input" data-text="basedOn" maxlength="255" placeholder="Minecraft, Mirror's Edge…" />`, 'Inspired by another game or scenery?')}
    ${section('Scenery', chipGroup('scenery', SCENERY), 'Match any selected scenery tag.', true)}
    ${section('Weather', chipGroup('weather', WEATHER), 'Match any selected weather.')}
    ${section('Time of day', chipGroup('timeOfDay', TIMES_OF_DAY), 'Match any selected time of day.')}
    ${section('Tech', chipGroup('tech', ['Box Tech']))}
    ${section('LJ & ladder rooms', `<div class="sub-group"><span class="field-label">LJ room</span>${chipGroup('ljRoom', TRI_OPTIONS)}</div>
       <div class="sub-group"><span class="field-label">LJ block</span>${chipGroup('ljBlock', LJ_BLOCK_OPTIONS)}</div>
       <div class="sub-group"><span class="field-label">Ladder room</span>${chipGroup('ladderRoom', TRI_OPTIONS)}</div>`)}
    ${section('Path', chipGroup('path', PATHS), 'How does the route flow?')}
    ${section('Special blocks', chipGroup('special', SPECIALS), 'Match any selected special section.')}
    ${section('Bonus', chipGroup('bonus', TRI_OPTIONS), 'Is this a bonus map?')}
  `;
    filterCountElForSync = required('#filter-count');
}
let filterCountElForSync = null;
// ---------------------------------------------------------------------------
// Filter state helpers
// ---------------------------------------------------------------------------
function arrayFilter(key) {
    const value = filters[key];
    return Array.isArray(value) ? value : [];
}
function setArrayFilter(key, values) {
    filters[key] = values;
}
function toggleValue(key, value) {
    const current = arrayFilter(key);
    setArrayFilter(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
}
function setExclusive(key, value) {
    setArrayFilter(key, value == null ? [] : [value]);
}
function setTopRange(min, max) {
    filters.topMin = min;
    filters.topMax = max;
}
function setTierRange(prefix, min, max) {
    if (prefix === 'tp') {
        filters.tpMin = min;
        filters.tpMax = max;
    }
    else {
        filters.proMin = min;
        filters.proMax = max;
    }
}
function setColour(key, value) {
    filters[key] = value;
}
function hasActiveFilters() {
    return countActiveFilters(filters) > 0;
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function syncSidebar() {
    if (!filtersEl.childElementCount)
        buildSidebar();
    $$('[data-toggle]', filtersEl).forEach((button) => {
        const key = button.dataset.toggle;
        const value = button.dataset.value ?? '';
        const active = arrayFilter(key).includes(value);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-mode-value]', filtersEl).forEach((button) => {
        const active = filters.materialsMode === button.dataset.modeValue;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    $$('[data-select]', filtersEl).forEach((select) => {
        const key = select.dataset.select;
        select.value = filters[key] ?? '';
    });
    $$('[data-tier]', filtersEl).forEach((select) => {
        const prefix = select.dataset.tier;
        const bound = select.dataset.bound;
        const value = prefix === 'tp' ? (bound === 'min' ? filters.tpMin : filters.tpMax) : bound === 'min' ? filters.proMin : filters.proMax;
        select.value = value == null ? '' : String(value);
    });
    $$('[data-text]', filtersEl).forEach((input) => {
        const key = input.dataset.text;
        if (document.activeElement !== input)
            input.value = filters[key] ?? '';
    });
    if (document.activeElement !== nameSearchEl)
        nameSearchEl.value = filters.q;
    syncTopRange();
    $$('[data-top-preset]', filtersEl).forEach((button) => {
        const preset = TOP_TIME_PRESETS[Number(button.dataset.topPreset)];
        const active = preset != null && filters.topMin === preset.min && filters.topMax === preset.max;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    const count = countActiveFilters(filters);
    const countEl = filterCountElForSync ?? $('#filter-count', filtersEl);
    if (countEl) {
        countEl.textContent = String(count);
        countEl.classList.toggle('is-empty', count === 0);
    }
}
function syncTopRange() {
    const minInput = $('[data-range-min]', filtersEl);
    const maxInput = $('[data-range-max]', filtersEl);
    const fill = $('[data-range-fill]', filtersEl);
    const readout = $('[data-top-readout]', filtersEl);
    if (!minInput || !maxInput || !fill || !readout)
        return;
    const min = filters.topMin ?? 0;
    const max = filters.topMax ?? TOP_RANGE_MAX;
    minInput.value = String(min);
    maxInput.value = String(max);
    fill.style.left = `${(min / TOP_RANGE_MAX) * 100}%`;
    fill.style.right = `${100 - (max / TOP_RANGE_MAX) * 100}%`;
    readout.textContent =
        filters.topMin == null && filters.topMax == null
            ? 'Any duration'
            : `${formatRange(filters.topMin, filters.topMax, 'm')} top time`;
}
function renderActiveFilters() {
    const chips = activeFilterChips(filters);
    if (chips.length === 0) {
        activeEl.innerHTML = `<span class="active-empty">No active filters — pick a property or press <kbd class="kbd">Ctrl</kbd><kbd class="kbd">P</kbd> to search by command.</span>`;
        return;
    }
    activeEl.innerHTML = `<span class="active-label">Active</span>${chips
        .map((chip) => `<button type="button" class="filter-chip${chip.subtle ? ' subtle' : ''}" data-chip-id="${escapeHtml(chip.id)}" title="Remove filter">${escapeHtml(chip.label)}<span class="filter-chip-x" aria-hidden="true">×</span></button>`)
        .join('')}<button type="button" class="link-btn active-clear" data-clear-all>Clear all</button>`;
}
function materialTag(material) {
    const className = `mat-${slugify(material) || 'unknown'}`;
    return `<span class="tag tag-material ${className}"><span class="mat-dot"></span>${escapeHtml(material)}</span>`;
}
function cardTags(map) {
    const tags = [];
    tags.push(...map.materials.slice(0, 2).map(materialTag));
    if (map.tech.length)
        tags.push(`<span class="tag tag-tech">${escapeHtml(map.tech[0])}</span>`);
    if (map.special.length)
        tags.push(`<span class="tag">${escapeHtml(map.special[0])}</span>`);
    if (map.path.length)
        tags.push(`<span class="tag">${escapeHtml(map.path[0])}</span>`);
    if (map.scenery.length && tags.length < 4)
        tags.push(`<span class="tag">${escapeHtml(map.scenery[0])}</span>`);
    return tags.slice(0, 4).join('');
}
function mapCard(map) {
    const thumb = map.thumbnail
        ? `<img class="thumb-img" src="${escapeHtml(map.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : '';
    return `<article class="map-card" data-map-id="${escapeHtml(map.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(map.name)}">
    <div class="map-thumb" style="${thumbStyle(map.name)}">
      ${thumb}
      <span class="map-initials" aria-hidden="true">${escapeHtml(mapInitials(map.name))}</span>
      <div class="map-badges">
        ${map.global === 'Yes' ? '<span class="badge badge-global">Global</span>' : ''}
        ${map.bonus === 'Yes' ? '<span class="badge badge-bonus">Bonus</span>' : ''}
      </div>
    </div>
    <div class="map-card-body">
      <h3 class="map-name">${escapeHtml(map.name)}</h3>
      <div class="map-stats">
        ${map.tpTier != null ? `<span class="stat stat-tp">TP ${map.tpTier}</span>` : '<span class="stat stat-empty">TP —</span>'}
        ${map.proTier != null ? `<span class="stat stat-pro">Pro ${map.proTier}</span>` : '<span class="stat stat-empty">Pro —</span>'}
        <span class="stat stat-time">${formatTopTime(map.topTime)}</span>
      </div>
      <div class="map-tags">${cardTags(map)}</div>
      <div class="map-footer">
        <span class="map-mapper">${escapeHtml(map.mappers || 'Unknown mapper')}</span>
        <span class="map-open">Details <span aria-hidden="true">→</span></span>
      </div>
    </div>
  </article>`;
}
function skeletonGrid() {
    return Array.from({ length: 8 }, () => `<div class="map-card map-skeleton"><div class="skel skel-thumb"></div><div class="skel-body"><div class="skel skel-line w70"></div><div class="skel skel-line w40"></div><div class="skel skel-line w90"></div></div></div>`).join('');
}
function renderResults() {
    if (!loaded)
        return;
    const filtered = sortMaps(filterMaps(maps, filters), sort);
    const visible = filtered.slice(0, limit);
    resultCountEl.innerHTML =
        `<strong>${filtered.length}</strong> ${filtered.length === 1 ? 'map' : 'maps'}` +
            (hasActiveFilters() && filtered.length !== maps.length ? ` <span class="result-of">of ${maps.length}</span>` : '');
    gridEl.innerHTML = visible.map(mapCard).join('');
    gridEl.hidden = filtered.length === 0;
    emptyEl.hidden = filtered.length !== 0;
    loadMoreEl.hidden = visible.length >= filtered.length;
    const remaining = Math.max(0, filtered.length - visible.length);
    loadMoreEl.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;
    bindThumbFallbacks();
}
function bindThumbFallbacks() {
    $$('.thumb-img', gridEl).forEach((image) => {
        image.addEventListener('error', () => {
            image.style.display = 'none';
        }, { once: true });
    });
}
function showLoading() {
    resultCountEl.textContent = 'Loading maps…';
    gridEl.hidden = false;
    emptyEl.hidden = true;
    loadMoreEl.hidden = true;
    gridEl.innerHTML = skeletonGrid();
}
function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    resultCountEl.textContent = 'Database unavailable';
    gridEl.hidden = false;
    emptyEl.hidden = true;
    loadMoreEl.hidden = true;
    gridEl.innerHTML = `<div class="error-panel">
    <span class="error-kicker">Data error</span>
    <h3>Could not load the map database</h3>
    <p>${escapeHtml(message)}</p>
    <div class="error-actions">
      <button type="button" class="btn accent" data-retry>Try again</button>
      <a class="btn" href="entry.html">Open data entry</a>
    </div>
  </div>`;
}
// ---------------------------------------------------------------------------
// Change plumbing
// ---------------------------------------------------------------------------
const renderSoon = (() => {
    let handle = 0;
    return () => {
        window.clearTimeout(handle);
        handle = window.setTimeout(() => renderResults(), 90);
    };
})();
function onFiltersChanged() {
    limit = PAGE_SIZE;
    syncSidebar();
    renderActiveFilters();
    renderResults();
    updateUrl();
}
function updateUrl() {
    try {
        const params = new URLSearchParams();
        const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS) && sort === 'name';
        if (!isDefault)
            params.set('f', encodeState(filters));
        if (sort !== 'name')
            params.set('s', sort);
        const query = params.toString();
        history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    }
    catch {
        // history API may be unavailable (file://); filtering still works.
    }
}
function hydrateFromUrl() {
    const params = new URLSearchParams(location.search);
    const encoded = params.get('f');
    const sortParam = params.get('s');
    if (sortParam && SORT_OPTIONS.some((option) => option.value === sortParam)) {
        sort = sortParam;
    }
    if (!encoded)
        return;
    const raw = decodeState(encoded);
    if (!raw)
        return;
    const merged = structuredClone(DEFAULT_FILTERS);
    for (const [key, value] of Object.entries(raw)) {
        if (!(key in merged))
            continue;
        const expected = merged[key];
        if (Array.isArray(expected)) {
            if (Array.isArray(value))
                merged[key] = value.filter((item) => typeof item === 'string');
        }
        else if (expected === null || typeof expected === 'number') {
            if (value === null || (typeof value === 'number' && Number.isFinite(value)))
                merged[key] = value;
        }
        else if (typeof expected === 'string') {
            if (typeof value === 'string')
                merged[key] = value;
        }
    }
    filters = merged;
    if (filters.topMin != null)
        filters.topMin = Math.max(0, Math.min(TOP_RANGE_MAX, filters.topMin));
    if (filters.topMax != null)
        filters.topMax = Math.max(0, Math.min(TOP_RANGE_MAX, filters.topMax));
}
// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------
function detailItem(label, value) {
    return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
const joinList = (values) => (values.length ? values.join(', ') : '—');
function detailValue(value) {
    return value && value.trim() ? value : '—';
}
function movementBhop(map, value, colour) {
    if (value === 'Yes' && colour)
        return `Yes · ${colour}`;
    return value;
}
function openMap(map) {
    const thumb = map.thumbnail
        ? `<img class="modal-thumb-img" src="${escapeHtml(map.thumbnail)}" alt="" referrerpolicy="no-referrer" />`
        : '';
    const links = [];
    if (map.workshopId) {
        links.push(`<a class="btn" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(map.workshopId)}" target="_blank" rel="noopener noreferrer">Steam Workshop ↗</a>`);
    }
    if (map.cs2kzId != null) {
        links.push(`<a class="btn" href="https://cs2kz.org/maps/${encodeURIComponent(map.name)}" target="_blank" rel="noopener noreferrer">cs2kz.org ↗</a>`);
    }
    modalContentEl.innerHTML = `
    <div class="modal-hero" style="${thumbStyle(map.name)}">
      ${thumb}
      <span class="modal-initials" aria-hidden="true">${escapeHtml(mapInitials(map.name))}</span>
      <div class="modal-hero-copy">
        <div class="modal-badges">
          ${map.global === 'Yes' ? '<span class="badge badge-global">Global</span>' : ''}
          ${map.global === 'No' ? '<span class="badge">Local</span>' : ''}
          ${map.bonus === 'Yes' ? '<span class="badge badge-bonus">Bonus map</span>' : ''}
        </div>
        <h2>${escapeHtml(map.name)}</h2>
        <p>${escapeHtml(map.description || 'No description yet.')}</p>
        <div class="modal-byline">${escapeHtml(map.mappers || 'Unknown mapper')} <span>·</span> ${escapeHtml(map.id)}</div>
      </div>
    </div>
    <div class="modal-stats">
      <div><span>TP tier</span><strong>${map.tpTier ?? '—'}</strong></div>
      <div><span>Pro tier</span><strong>${map.proTier ?? '—'}</strong></div>
      <div><span>Top time</span><strong>${formatTopTime(map.topTime)}</strong></div>
      <div><span>Port</span><strong>${escapeHtml(map.port)}</strong></div>
    </div>
    <div class="modal-body">
      <section class="detail-section">
        <h3>Core</h3>
        <div class="detail-grid">
          ${detailItem('Global', map.global)}
          ${detailItem('Bonus', map.bonus)}
          ${detailItem('Materials', joinList(map.materials))}
          ${detailItem('Props', joinList(map.props))}
          ${detailItem('Top time', formatTopTime(map.topTime))}
          ${detailItem('TP / Pro tier', `${map.tpTier ?? '—'} / ${map.proTier ?? '—'}`)}
          ${detailItem('Port', map.port)}
          ${detailItem('Based on', detailValue(map.basedOn))}
        </div>
      </section>
      <section class="detail-section">
        <h3>Movement</h3>
        <div class="detail-grid">
          ${detailItem('Headbangers', map.headbangers)}
          ${detailItem('Ladders', `${joinList(map.ladderAmount)} · ${joinList(map.ladderTypes)}`)}
          ${detailItem('Bhop', movementBhop(map, map.bhop, map.bhopColour))}
          ${detailItem('Multi', movementBhop(map, map.multi, map.multiColour))}
          ${detailItem('Prekeep', movementBhop(map, map.prekeep, map.prekeepColour))}
          ${detailItem('Surfs', `${joinList(map.surfAmounts)} · ${joinList(map.surfMaterials)}`)}
          ${detailItem('LJ room', map.ljRoom)}
          ${detailItem('LJ block', map.ljBlock)}
          ${detailItem('Ladder room', map.ladderRoom)}
          ${detailItem('Path', joinList(map.path))}
          ${detailItem('Special', joinList(map.special))}
        </div>
      </section>
      <section class="detail-section">
        <h3>World</h3>
        <div class="detail-grid">
          ${detailItem('Scenery', joinList(map.scenery))}
          ${detailItem('Weather', joinList(map.weather))}
          ${detailItem('Time of day', joinList(map.timeOfDay))}
          ${detailItem('Tech', joinList(map.tech))}
        </div>
      </section>
      <section class="detail-section">
        <h3>Meta</h3>
        <div class="detail-grid">
          ${detailItem('Record ID', map.id)}
          ${detailItem('Mappers', detailValue(map.mappers))}
          ${detailItem('Updated', new Date(map.updatedAt).toLocaleString())}
          ${detailItem('Workshop ID', map.workshopId ?? '—')}
        </div>
      </section>
    </div>
    <div class="modal-actions">
      ${links.join('')}
      <button type="button" class="btn" data-copy-json>Copy JSON</button>
    </div>`;
    modalEl.hidden = false;
    document.body.classList.add('modal-open');
    required('.modal-close').focus();
    $$('.modal-thumb-img', modalEl).forEach((image) => {
        image.addEventListener('error', () => image.remove(), { once: true });
    });
    $('[data-copy-json]', modalEl)?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(map, null, 2));
            toast('Map JSON copied to clipboard');
        }
        catch {
            toast('Clipboard unavailable');
        }
    });
}
function closeModal() {
    modalEl.hidden = true;
    document.body.classList.remove('modal-open');
    modalContentEl.innerHTML = '';
}
// ---------------------------------------------------------------------------
// Quick menu commands
// ---------------------------------------------------------------------------
const triCommands = (idPrefix, apply) => TRI_OPTIONS.map((value) => ({
    id: `${idPrefix}:${value}`,
    label: value,
    keywords: value === 'Yes' ? ['y', 'true'] : value === 'No' ? ['n', 'false'] : ['u', 'unk'],
    run: () => apply(value),
}));
const amountCommands = (key, hint = 'Add amount filter') => AMOUNTS.map((value) => ({
    id: `${String(key)}:${value}`,
    label: value,
    hint,
    keywords: value === 'None' ? ['n'] : value === 'Unknown' ? ['u', 'unk'] : [],
    run: () => {
        toggleValue(key, value);
        onFiltersChanged();
    },
}));
const materialCommands = (key, hint) => MATERIALS.map((value) => ({
    id: `${key}:${value}`,
    label: value,
    hint,
    run: () => {
        toggleValue(key, value);
        onFiltersChanged();
    },
}));
function focusFilterField(selector) {
    requestAnimationFrame(() => {
        const field = $(selector);
        if (!field)
            return;
        if (field.closest('#filters') && window.matchMedia('(max-width: 960px)').matches) {
            openMobileFilters();
        }
        field.closest('details')?.setAttribute('open', '');
        field.focus();
        field.select();
    });
}
function topMinCommand(min) {
    const maxOptions = [1, 2, 3, 4, 5, 10, 20].filter((max) => max >= min);
    return {
        id: `top-min:${min}`,
        label: String(min),
        hint: `at least ${min} min`,
        keywords: [`${min}m`],
        children: [
            ...maxOptions.map((max) => ({
                id: `top:${min}-${max}`,
                label: String(max),
                hint: `${min}–${max} min`,
                keywords: [`${max}m`],
                run: () => {
                    setTopRange(min, max);
                    onFiltersChanged();
                },
            })),
            {
                id: `top:${min}-open`,
                label: 'No max',
                hint: `${min}m or longer`,
                keywords: ['open', 'plus', 'max'],
                run: () => {
                    setTopRange(min, null);
                    onFiltersChanged();
                },
            },
        ],
    };
}
function tierMinCommand(prefix, min) {
    return {
        id: `${prefix}-tier:${min}`,
        label: String(min),
        hint: `tier ${min} or higher`,
        children: [
            ...Array.from({ length: 10 - min }, (_, index) => min + index).map((max) => ({
                id: `${prefix}-tier:${min}-${max}`,
                label: String(max),
                hint: max === min ? `exactly ${min}` : `${min}–${max}`,
                run: () => {
                    setTierRange(prefix, min, max);
                    onFiltersChanged();
                },
            })),
            {
                id: `${prefix}-tier:${min}-open`,
                label: 'No max',
                hint: `${min}+`,
                run: () => {
                    setTierRange(prefix, min, null);
                    onFiltersChanged();
                },
            },
        ],
    };
}
function colourCommand(key, applyKey) {
    return COLOURS.map((value) => ({
        id: `${key}:${value}`,
        label: value,
        hint: 'Requires surface colour',
        run: () => {
            setExclusive(applyKey, 'Yes');
            setColour(key, value);
            onFiltersChanged();
        },
    }));
}
const movementRoot = (key, label, colourKey) => ({
    id: key,
    label,
    keywords: [key, `${key} surfaces`],
    children: [
        ...triCommands(key, (value) => {
            setExclusive(key, value);
            if (value !== 'Yes')
                setColour(colourKey, null);
            onFiltersChanged();
        }),
        {
            id: `${key}-colour`,
            label: 'Colour',
            hint: 'Surface colour (implies Yes)',
            keywords: ['color', 'colour'],
            children: colourCommand(colourKey, key),
        },
        {
            id: `${key}-colour-clear`,
            label: 'Clear colour',
            hint: 'Any surface colour',
            run: () => {
                setColour(colourKey, null);
                onFiltersChanged();
            },
        },
    ],
});
function buildPaletteCommands() {
    return [
        {
            id: 'global',
            label: 'Globalness',
            hint: 'Yes / No / Unknown',
            keywords: ['global', 'glo', 'globalled'],
            children: [
                ...triCommands('global', (value) => {
                    setExclusive('global', value);
                    onFiltersChanged();
                }),
                {
                    id: 'global-clear',
                    label: 'Clear',
                    hint: 'Any global-ness',
                    run: () => {
                        setExclusive('global', null);
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'materials',
            label: 'Material-ness',
            hint: 'Concrete, Grass, Wood…',
            keywords: ['material', 'mat', 'materials'],
            children: [
                ...materialCommands('materials', 'Add material (AND by default)'),
                {
                    id: 'materials-mode',
                    label: 'Match mode',
                    hint: 'All of / Any of',
                    children: [
                        {
                            id: 'materials-mode:all',
                            label: 'All of',
                            hint: 'Map must include every selected material',
                            run: () => {
                                filters.materialsMode = 'all';
                                onFiltersChanged();
                            },
                        },
                        {
                            id: 'materials-mode:any',
                            label: 'Any of',
                            hint: 'Map may include any selected material',
                            run: () => {
                                filters.materialsMode = 'any';
                                onFiltersChanged();
                            },
                        },
                    ],
                },
                {
                    id: 'materials-clear',
                    label: 'Clear',
                    hint: 'Remove material filters',
                    run: () => {
                        filters.materials = [];
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'props',
            label: 'Props',
            hint: 'None / Some / Lots / All',
            keywords: ['prop', 'props'],
            children: amountCommands('props'),
        },
        {
            id: 'top',
            label: 'Top time',
            hint: 'e.g. Top > 1 > 2',
            keywords: ['top', 'time', 'duration', 'range'],
            children: [
                {
                    id: 'top-under-1',
                    label: '< 1m',
                    hint: 'Under one minute',
                    keywords: ['under', 'less'],
                    run: () => {
                        setTopRange(null, 1);
                        onFiltersChanged();
                    },
                },
                ...[1, 2, 3, 4, 5, 10, 20].map((min) => topMinCommand(min)),
                {
                    id: 'top-clear',
                    label: 'Any',
                    hint: 'Clear top time range',
                    run: () => {
                        setTopRange(null, null);
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'tp-tier',
            label: 'TP tier',
            hint: 'Tier range 1–9',
            keywords: ['tp', 'tier', 'nub tier'],
            children: [
                ...Array.from({ length: 9 }, (_, index) => tierMinCommand('tp', index + 1)),
                {
                    id: 'tp-tier-clear',
                    label: 'Any',
                    hint: 'Clear tier range',
                    run: () => {
                        setTierRange('tp', null, null);
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'pro-tier',
            label: 'Pro tier',
            hint: 'Tier range 1–9',
            keywords: ['pro', 'tier'],
            children: [
                ...Array.from({ length: 9 }, (_, index) => tierMinCommand('pro', index + 1)),
                {
                    id: 'pro-tier-clear',
                    label: 'Any',
                    hint: 'Clear tier range',
                    run: () => {
                        setTierRange('pro', null, null);
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'headbangers',
            label: 'Headbangers',
            hint: 'Yes / No / Unknown',
            keywords: ['headbanger', 'hb'],
            children: triCommands('headbangers', (value) => {
                setExclusive('headbangers', value);
                onFiltersChanged();
            }),
        },
        {
            id: 'ladders',
            label: 'Ladders',
            hint: 'Amount / construction',
            keywords: ['ladder', 'lad'],
            children: [
                { id: 'ladder-amount', label: 'Amount', hint: 'None / Some / Lots / All', children: amountCommands('ladderAmount') },
                { id: 'ladder-type', label: 'Construction', hint: 'Prop / Rope / Inset…', keywords: ['type', 'ladder type', 'build'], children: LADDER_TYPES.map((value) => ({
                        id: `ladderTypes:${value}`,
                        label: value,
                        run: () => {
                            toggleValue('ladderTypes', value);
                            onFiltersChanged();
                        },
                    })) },
            ],
        },
        movementRoot('bhop', 'Bhop', 'bhopColour'),
        movementRoot('multi', 'Multi', 'multiColour'),
        movementRoot('prekeep', 'Prekeep', 'prekeepColour'),
        {
            id: 'surfs',
            label: 'Surfs',
            hint: 'Yes / No / amount / material',
            keywords: ['surf', 'sur', 'surfs'],
            children: [
                {
                    id: 'surfs-yes',
                    label: 'Yes',
                    hint: 'Any surf amount except None',
                    keywords: ['y'],
                    run: () => {
                        setArrayFilter('surfAmounts', ['Some', 'Lots', 'All']);
                        onFiltersChanged();
                    },
                },
                {
                    id: 'surfs-no',
                    label: 'No',
                    hint: 'No surf sections',
                    keywords: ['n'],
                    run: () => {
                        setArrayFilter('surfAmounts', ['None']);
                        onFiltersChanged();
                    },
                },
                {
                    id: 'surfs-unknown',
                    label: 'Unknown',
                    hint: 'Surf amount unknown',
                    keywords: ['u'],
                    run: () => {
                        setArrayFilter('surfAmounts', ['Unknown']);
                        onFiltersChanged();
                    },
                },
                { id: 'surfs-amount', label: 'Amount', hint: 'None / Some / Lots / All', children: amountCommands('surfAmounts') },
                { id: 'surfs-material', label: 'Material', hint: 'Surf surface material', children: materialCommands('surfMaterials', 'Add surf material') },
            ],
        },
        {
            id: 'ports',
            label: 'Port',
            hint: 'GO / Source / 1.6 / Unknown',
            keywords: ['port', 'ported'],
            children: PORTS.map((value) => ({
                id: `ports:${value}`,
                label: value,
                run: () => {
                    setExclusive('ports', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'based-on',
            label: 'Based on',
            hint: 'Search game / scenery inspiration',
            keywords: ['based', 'base', 'game'],
            run: () => focusFilterField('[data-text="basedOn"]'),
        },
        {
            id: 'weather',
            label: 'Weather',
            hint: 'Winter, Sunny, Raining…',
            keywords: ['weather', 'wea'],
            children: WEATHER.map((value) => ({
                id: `weather:${value}`,
                label: value,
                run: () => {
                    toggleValue('weather', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'scenery',
            label: 'Scenery',
            hint: 'Indoors, Water, Lava…',
            keywords: ['scenery', 'scene', 'scen'],
            children: SCENERY.map((value) => ({
                id: `scenery:${value}`,
                label: value,
                run: () => {
                    toggleValue('scenery', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'time-of-day',
            label: 'Time of day',
            hint: 'Dawn / Day / Dusk / Night',
            keywords: ['time', 'day', 'night'],
            children: TIMES_OF_DAY.map((value) => ({
                id: `timeOfDay:${value}`,
                label: value,
                run: () => {
                    toggleValue('timeOfDay', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'tech',
            label: 'Tech',
            hint: 'Box Tech',
            keywords: ['tech', 'box'],
            children: [
                {
                    id: 'tech:Box Tech',
                    label: 'Box Tech',
                    hint: 'Toggle Box Tech filter',
                    run: () => {
                        toggleValue('tech', 'Box Tech');
                        onFiltersChanged();
                    },
                },
            ],
        },
        {
            id: 'lj-rooms',
            label: 'LJ & ladder rooms',
            hint: 'LJ room, block, ladder room',
            keywords: ['lj', 'long jump', 'room', 'ladder room'],
            children: [
                { id: 'ljRoom', label: 'LJ room', children: triCommands('ljRoom', (value) => {
                        setExclusive('ljRoom', value);
                        onFiltersChanged();
                    }) },
                { id: 'ljBlock', label: 'LJ block', children: LJ_BLOCK_OPTIONS.map((value) => ({
                        id: `ljBlock:${value}`,
                        label: value,
                        run: () => {
                            setExclusive('ljBlock', value);
                            onFiltersChanged();
                        },
                    })) },
                { id: 'ladderRoom', label: 'Ladder room', children: triCommands('ladderRoom', (value) => {
                        setExclusive('ladderRoom', value);
                        onFiltersChanged();
                    }) },
            ],
        },
        {
            id: 'path',
            label: 'Path',
            hint: 'Linear, Spiral, Locked…',
            keywords: ['path', 'route'],
            children: PATHS.map((value) => ({
                id: `path:${value}`,
                label: value,
                run: () => {
                    toggleValue('path', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'special',
            label: 'Special blocks',
            hint: 'Boosters, pads, slides…',
            keywords: ['special', 'blocks', 'boosters', 'jump pads'],
            children: SPECIALS.map((value) => ({
                id: `special:${value}`,
                label: value,
                run: () => {
                    toggleValue('special', value);
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'bonus',
            label: 'Bonus',
            hint: 'Yes / No / Unknown',
            keywords: ['bonus'],
            children: triCommands('bonus', (value) => {
                setExclusive('bonus', value);
                onFiltersChanged();
            }),
        },
        {
            id: 'name',
            label: 'Map name',
            hint: 'Focus the name search',
            keywords: ['name', 'map', 'search'],
            run: () => focusFilterField('#name-search'),
        },
        {
            id: 'sort',
            label: 'Sort',
            hint: 'Change result ordering',
            keywords: ['sort', 'order'],
            children: SORT_OPTIONS.map((option) => ({
                id: `sort:${option.value}`,
                label: option.label,
                run: () => {
                    sort = option.value;
                    sortEl.value = sort;
                    onFiltersChanged();
                },
            })),
        },
        {
            id: 'clear-all',
            label: 'Clear all filters',
            hint: 'Reset every search property',
            keywords: ['reset', 'clear', 'none'],
            run: () => {
                clearFilters(filters);
                onFiltersChanged();
            },
        },
    ];
}
// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function isTypingTarget(target) {
    if (!(target instanceof HTMLElement))
        return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
function closeMobileFilters() {
    filtersEl.classList.remove('drawer-open');
    filtersBackdropEl.hidden = true;
    filtersToggleEl.setAttribute('aria-expanded', 'false');
}
function openMobileFilters() {
    filtersEl.classList.add('drawer-open');
    filtersBackdropEl.hidden = false;
    filtersToggleEl.setAttribute('aria-expanded', 'true');
}
function bindEvents() {
    filtersEl.addEventListener('click', (event) => {
        const target = event.target;
        const toggle = target.closest('[data-toggle]');
        if (toggle) {
            toggleValue(toggle.dataset.toggle, toggle.dataset.value ?? '');
            onFiltersChanged();
            return;
        }
        const mode = target.closest('[data-mode-value]');
        if (mode) {
            filters.materialsMode = mode.dataset.modeValue === 'any' ? 'any' : 'all';
            onFiltersChanged();
            return;
        }
        const preset = target.closest('[data-top-preset]');
        if (preset) {
            const value = TOP_TIME_PRESETS[Number(preset.dataset.topPreset)];
            if (!value)
                return;
            const active = filters.topMin === value.min && filters.topMax === value.max;
            setTopRange(active ? null : value.min, active ? null : value.max);
            onFiltersChanged();
            return;
        }
        if (target.closest('[data-clear-top]')) {
            setTopRange(null, null);
            onFiltersChanged();
            return;
        }
        if (target.closest('#clear-filters-side')) {
            clearFilters(filters);
            onFiltersChanged();
            return;
        }
        if (target.closest('#filters-close')) {
            closeMobileFilters();
        }
    });
    filtersEl.addEventListener('change', (event) => {
        const target = event.target;
        const select = target.closest('select');
        if (!select)
            return;
        if (select.dataset.select) {
            setColour(select.dataset.select, (select.value || null));
            onFiltersChanged();
            return;
        }
        if (select.dataset.tier) {
            const prefix = select.dataset.tier;
            const bound = select.dataset.bound;
            const value = select.value ? Number(select.value) : null;
            let min = prefix === 'tp' ? filters.tpMin : filters.proMin;
            let max = prefix === 'tp' ? filters.tpMax : filters.proMax;
            if (bound === 'min')
                min = value;
            else
                max = value;
            if (min != null && max != null && min > max) {
                if (bound === 'min')
                    max = min;
                else
                    min = max;
            }
            setTierRange(prefix, min, max);
            onFiltersChanged();
        }
    });
    const textHandler = (() => {
        let handle = 0;
        return (input, value) => {
            window.clearTimeout(handle);
            handle = window.setTimeout(() => {
                filters[input.dataset.text] = value;
                onFiltersChanged();
            }, 220);
        };
    })();
    filtersEl.addEventListener('input', (event) => {
        const target = event.target;
        const text = target.closest('[data-text]');
        if (text) {
            textHandler(text, text.value);
            return;
        }
        if (target.matches('[data-range-min]') || target.matches('[data-range-max]')) {
            const minInput = $('[data-range-min]', filtersEl);
            const maxInput = $('[data-range-max]', filtersEl);
            let min = Number(minInput.value);
            let max = Number(maxInput.value);
            if (min > max) {
                if (target === minInput) {
                    min = max;
                    minInput.value = String(min);
                }
                else {
                    max = min;
                    maxInput.value = String(max);
                }
            }
            setTopRange(min === 0 ? null : min, max === TOP_RANGE_MAX ? null : max);
            syncTopRange();
            renderActiveFilters();
            const rangeCountEl = filterCountElForSync ?? $('#filter-count', filtersEl);
            if (rangeCountEl)
                rangeCountEl.textContent = String(countActiveFilters(filters));
            $$('[data-top-preset]', filtersEl).forEach((button) => {
                const preset = TOP_TIME_PRESETS[Number(button.dataset.topPreset)];
                button.classList.toggle('active', preset != null && filters.topMin === preset.min && filters.topMax === preset.max);
            });
            renderSoon();
            updateUrl();
        }
    });
    nameSearchEl.addEventListener('input', () => {
        filters.q = nameSearchEl.value;
        limit = PAGE_SIZE;
        renderSoon();
        renderActiveFilters();
        updateUrl();
        const countEl = filterCountElForSync ?? $('#filter-count', filtersEl);
        if (countEl)
            countEl.textContent = String(countActiveFilters(filters));
    });
    sortEl.addEventListener('change', () => {
        sort = sortEl.value;
        limit = PAGE_SIZE;
        renderResults();
        updateUrl();
    });
    loadMoreEl.addEventListener('click', () => {
        limit += PAGE_SIZE;
        renderResults();
    });
    activeEl.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('[data-clear-all]')) {
            clearFilters(filters);
            onFiltersChanged();
            return;
        }
        const button = target.closest('[data-chip-id]');
        if (!button)
            return;
        const chip = activeFilterChips(filters).find((entry) => entry.id === button.dataset.chipId);
        if (chip) {
            removeFilterChip(filters, chip);
            onFiltersChanged();
        }
    });
    gridEl.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('[data-retry]')) {
            void loadData();
            return;
        }
        const card = target.closest('[data-map-id]');
        if (!card)
            return;
        const map = mapById.get(card.dataset.mapId ?? '');
        if (map)
            openMap(map);
    });
    gridEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ')
            return;
        const card = event.target.closest('[data-map-id]');
        if (!card)
            return;
        event.preventDefault();
        const map = mapById.get(card.dataset.mapId ?? '');
        if (map)
            openMap(map);
    });
    modalEl.addEventListener('click', (event) => {
        if (event.target.closest('[data-modal-close]'))
            closeModal();
    });
    filtersToggleEl.addEventListener('click', () => {
        if (filtersEl.classList.contains('drawer-open'))
            closeMobileFilters();
        else
            openMobileFilters();
    });
    filtersBackdropEl.addEventListener('click', closeMobileFilters);
    required('#palette-open').addEventListener('click', () => palette.open());
    $$('[data-clear-filters]').forEach((button) => {
        button.addEventListener('click', () => {
            clearFilters(filters);
            onFiltersChanged();
        });
    });
    document.addEventListener('keydown', (event) => {
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && ['p', 'k'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            if (palette.isOpen())
                return;
            closeMobileFilters();
            palette.open();
            return;
        }
        if (event.key === 'Escape') {
            if (modalEl.hidden === false)
                closeModal();
            else
                closeMobileFilters();
            return;
        }
        if (event.key === '/' && !isTypingTarget(event.target) && palette?.isOpen() !== true) {
            event.preventDefault();
            nameSearchEl.focus();
            nameSearchEl.select();
        }
    });
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function loadData() {
    showLoading();
    try {
        const result = await loadServedDataset();
        maps = result.dataset.maps;
        mapById = new Map(maps.map((map) => [map.id, map]));
        loaded = true;
        const updated = new Date(result.dataset.updatedAt);
        datasetMetaEl.innerHTML = `<span class="meta-dot"></span>${maps.length} maps <span class="meta-sep">·</span> updated ${updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        datasetMetaEl.title = `Loaded from ${result.source}`;
        renderResults();
    }
    catch (error) {
        loaded = false;
        showError(error);
    }
}
function boot() {
    hydrateFromUrl();
    buildSidebar();
    syncSidebar();
    renderActiveFilters();
    sortEl.value = sort;
    palette = new CommandPalette({
        commands: buildPaletteCommands(),
        placeholder: 'e.g. Glo > Y   ·   Mat > Con   ·   Top > 1 > 2   ·   Bh > Yes',
        ariaLabel: 'Quick filter menu',
    });
    bindEvents();
    showLoading();
    void loadData();
}
boot();
//# sourceMappingURL=search.js.map