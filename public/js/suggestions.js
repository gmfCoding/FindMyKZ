import { fetchSuggestions, postSuggestion, voteSuggestion } from './api.js';
import { ACTION_LABELS, AREA_LABELS, SUGGESTION_ACTIONS, SUGGESTION_LIMITS, suggestionTitle, validateSuggestion, } from './suggestion-types.js';
import { catalogueFor } from './suggestion-catalogue.js';
import { $$, escapeHtml, fuzzyScore, matchesAllTokens, plural, required } from './util.js';
const PAGE_SIZE = 30;
const metaEl = required('#suggest-meta');
const searchEl = required('#suggest-search');
const areaFilterEl = required('#filter-area');
const actionFilterEl = required('#filter-action');
const resetEl = required('#filter-reset');
const summaryEl = required('#suggest-summary');
const listEl = required('#suggest-list');
const moreEl = required('#suggest-more');
const formEl = required('#suggest-form');
const areaEl = required('#sg-area');
const actionFieldEl = required('#sg-action-field');
const actionGroupEl = required('#sg-action');
const nameEl = required('#sg-name');
const nameLabelEl = required('#sg-name-label');
const nameListEl = required('#sg-name-list');
const nameNoteEl = required('#sg-name-note');
const nameHintEl = required('#sg-name-hint');
const bodyEl = required('#sg-body');
const bodyCountEl = required('#sg-body-count');
const previewEl = required('#sg-preview');
const errorEl = required('#form-error');
const submitEl = required('#form-submit');
const toastEl = required('#toast');
let all = [];
let visible = [];
let shown = PAGE_SIZE;
let serverAvailable = true;
let loaded = false;
let formAction = 'add';
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
    }, 2400);
}
// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
/** Most liked first; fewer downvotes, then newest, break ties. */
function byLikes(a, b) {
    return b.up - a.up || a.down - b.down || b.id - a.id;
}
function haystack(s) {
    return [s.title, s.body, s.name, AREA_LABELS[s.area], s.action ? ACTION_LABELS[s.action] : '', s.example ? 'example suggestion' : '']
        .join(' ')
        .toLowerCase();
}
function hasFilters() {
    return Boolean(searchEl.value.trim() || areaFilterEl.value || actionFilterEl.value);
}
function applyFilters() {
    const query = searchEl.value.trim().toLowerCase();
    visible = all
        .filter((s) => !areaFilterEl.value || s.area === areaFilterEl.value)
        .filter((s) => !actionFilterEl.value || s.action === actionFilterEl.value)
        .filter((s) => !query || matchesAllTokens(query, haystack(s)))
        .sort(byLikes);
    shown = PAGE_SIZE;
    resetEl.hidden = !hasFilters();
    render();
}
function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 14 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 10 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function cardHtml(s) {
    const badges = [
        `<span class="suggest-badge area-${s.area}">${escapeHtml(AREA_LABELS[s.area])}</span>`,
        s.example ? '<span class="suggest-badge example" title="Shown as an example of how to suggest">Example Suggestion</span>' : '',
        s.action ? `<span class="suggest-badge action-${s.action}">${escapeHtml(ACTION_LABELS[s.action])}</span>` : '',
    ].join('');
    return `
    <article class="suggest-card" data-id="${s.id}">
      <div class="suggest-votes" role="group" aria-label="Votes">
        <button type="button" class="vote-btn up${s.myVote === 1 ? ' active' : ''}" data-vote="1"
          aria-pressed="${s.myVote === 1}" aria-label="Upvote (${s.up})" title="Upvote">
          ${ARROW_UP}<span class="vote-count">${s.up}</span>
        </button>
        <button type="button" class="vote-btn down${s.myVote === -1 ? ' active' : ''}" data-vote="-1"
          aria-pressed="${s.myVote === -1}" aria-label="Downvote (${s.down})" title="Downvote">
          ${ARROW_DOWN}<span class="vote-count">${s.down}</span>
        </button>
      </div>
      <div class="suggest-body">
        <div class="suggest-badges">${badges}<span class="suggest-date">${escapeHtml(formatDate(s.createdAt))}</span></div>
        <h3 class="suggest-title">${escapeHtml(s.title)}</h3>
        ${s.body ? `<p class="suggest-text">${escapeHtml(s.body)}</p>` : ''}
      </div>
    </article>`;
}
function emptyMessage() {
    if (!serverAvailable) {
        return `<div class="suggest-empty"><strong>Suggestions are offline.</strong>
      <p>The suggestions board needs the FindMyKZ server (<code>npm run server</code>). Try again once it is running.</p></div>`;
    }
    if (all.length === 0) {
        return `<div class="suggest-empty"><strong>No suggestions yet.</strong>
      <p>Be the first — use the form to propose a change.</p></div>`;
    }
    return `<div class="suggest-empty"><strong>No suggestions match.</strong>
    <p>Try a different search or clear the filters.</p></div>`;
}
function render() {
    if (!loaded) {
        summaryEl.textContent = 'Loading…';
        return;
    }
    const slice = visible.slice(0, shown);
    listEl.innerHTML = slice.length ? slice.map(cardHtml).join('') : emptyMessage();
    moreEl.hidden = visible.length <= shown;
    moreEl.textContent = `Show more (${visible.length - shown} left)`;
    summaryEl.textContent = serverAvailable
        ? hasFilters()
            ? `${plural(visible.length, 'suggestion')} match · sorted by most liked`
            : `${plural(all.length, 'suggestion')} · sorted by most liked`
        : '';
    metaEl.textContent = serverAvailable ? plural(all.length, 'suggestion') : 'Server offline';
}
function replaceSuggestion(updated) {
    const index = all.findIndex((s) => s.id === updated.id);
    if (index >= 0)
        all[index] = updated;
    const vIndex = visible.findIndex((s) => s.id === updated.id);
    if (vIndex >= 0)
        visible[vIndex] = updated;
    const card = listEl.querySelector(`.suggest-card[data-id="${updated.id}"]`);
    if (card)
        card.outerHTML = cardHtml(updated);
}
listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('.vote-btn');
    const card = button?.closest('.suggest-card');
    if (!button || !card)
        return;
    const id = Number(card.dataset.id);
    const current = all.find((s) => s.id === id);
    if (!current)
        return;
    const clicked = Number(button.dataset.vote);
    const next = current.myVote === clicked ? 0 : clicked;
    $$('.vote-btn', card).forEach((b) => (b.disabled = true));
    const result = await voteSuggestion(id, next);
    if (result.ok) {
        replaceSuggestion(result.data.suggestion);
        const fresh = listEl.querySelector(`.suggest-card[data-id="${id}"] .vote-btn[data-vote="${clicked}"]`);
        fresh?.focus();
    }
    else {
        $$('.vote-btn', card).forEach((b) => (b.disabled = false));
        toast(result.status === 429 ? result.error : `Could not save your vote: ${result.error}`);
    }
});
moreEl.addEventListener('click', () => {
    shown += PAGE_SIZE;
    render();
});
for (const control of [areaFilterEl, actionFilterEl])
    control.addEventListener('change', applyFilters);
searchEl.addEventListener('input', applyFilters);
resetEl.addEventListener('click', () => {
    searchEl.value = '';
    areaFilterEl.value = '';
    actionFilterEl.value = '';
    applyFilters();
});
// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
const NAME_PLACEHOLDERS = {
    material: 'e.g. Glass',
    property: 'e.g. Wall-runs',
    field: 'e.g. Map author',
    general: 'e.g. Let people filter by mapper',
};
// Update/remove target something that already exists, so offer a searchable list.
const MAX_SUGGESTED = 200;
const SUBSTRING_SCORE = 500;
let comboItems = [];
let comboActive = -1;
function picking(area = areaEl.value) {
    return area !== 'general' && formAction !== 'add';
}
function findExisting(area, name) {
    const wanted = name.replace(/\s+/g, ' ').trim().toLowerCase();
    return wanted ? catalogueFor(area).find((item) => item.name.toLowerCase() === wanted) : undefined;
}
function updateNameNote(area) {
    const typed = nameEl.value.trim();
    let note = '';
    if (area !== 'general' && typed) {
        const exists = Boolean(findExisting(area, typed));
        if (formAction === 'add' && exists)
            note = 'That already exists — consider suggesting an update instead.';
        else if (formAction !== 'add' && !exists)
            note = 'Not in the list — it will be posted as typed.';
    }
    nameNoteEl.textContent = note;
    nameNoteEl.hidden = !note;
}
function closeCombo() {
    nameListEl.hidden = true;
    nameEl.setAttribute('aria-expanded', 'false');
    nameEl.removeAttribute('aria-activedescendant');
    comboActive = -1;
}
function setActive(index) {
    comboActive = index;
    nameListEl.querySelectorAll('.combo-option').forEach((option, i) => {
        const active = i === index;
        option.classList.toggle('active', active);
        option.setAttribute('aria-selected', String(active));
        if (active) {
            nameEl.setAttribute('aria-activedescendant', option.id);
            option.scrollIntoView({ block: 'nearest' });
        }
    });
}
function openCombo() {
    const area = areaEl.value;
    if (!picking(area))
        return;
    const query = nameEl.value.trim();
    let matches = catalogueFor(area);
    if (query) {
        // A match on the name outranks one that only matches the hint (e.g. the scenery group).
        const scored = matches
            .map((item) => ({
            item,
            score: Math.max(fuzzyScore(query, item.name) ?? -1, (fuzzyScore(query, item.hint) ?? -1) - 400),
        }))
            .filter((entry) => entry.score >= 0);
        // Loose in-order letter matches only apply when nothing contains the text outright.
        const direct = scored.filter((entry) => entry.score >= SUBSTRING_SCORE);
        matches = (direct.length ? direct : scored).sort((a, b) => b.score - a.score).map((entry) => entry.item);
    }
    comboItems = matches.slice(0, MAX_SUGGESTED);
    nameListEl.innerHTML = comboItems.length
        ? comboItems
            .map((item, i) => `<li class="combo-option" role="option" id="sg-opt-${i}" aria-selected="false" data-index="${i}">
              <span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.hint)}</small></li>`)
            .join('')
        : '<li class="combo-empty" aria-disabled="true">No matches — you can still type your own.</li>';
    nameListEl.hidden = false;
    nameEl.setAttribute('aria-expanded', 'true');
    comboActive = -1;
    if (query && comboItems.length)
        setActive(0);
}
function chooseItem(index) {
    const item = comboItems[index];
    if (!item)
        return;
    nameEl.value = item.name;
    closeCombo();
    updateFormHints();
    bodyEl.focus();
}
nameEl.addEventListener('focus', openCombo);
nameEl.addEventListener('input', openCombo);
nameEl.addEventListener('blur', () => {
    closeCombo();
    const area = areaEl.value;
    const existing = picking(area) ? findExisting(area, nameEl.value) : undefined;
    if (existing && nameEl.value !== existing.name)
        nameEl.value = existing.name;
    updateFormHints();
});
nameEl.addEventListener('keydown', (event) => {
    if (nameListEl.hidden) {
        if (event.key === 'ArrowDown' && picking()) {
            event.preventDefault();
            openCombo();
        }
        return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!comboItems.length)
            return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((comboActive + step + comboItems.length) % comboItems.length);
    }
    else if (event.key === 'Enter' && comboActive >= 0) {
        event.preventDefault();
        chooseItem(comboActive);
    }
    else if (event.key === 'Escape') {
        event.preventDefault();
        closeCombo();
    }
});
// mousedown (not click) so the input keeps focus and blur doesn't close the list first
nameListEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const option = event.target.closest('.combo-option');
    if (option)
        chooseItem(Number(option.dataset.index));
});
function updateFormHints() {
    const area = areaEl.value;
    const general = area === 'general';
    actionFieldEl.hidden = general;
    nameLabelEl.textContent = general ? 'Summary' : 'Name';
    nameEl.placeholder = picking(area) ? 'Search existing…' : (NAME_PLACEHOLDERS[area] ?? '');
    nameHintEl.textContent = general ? '' : formAction === 'add' ? 'the new name' : 'pick from the list';
    if (!picking(area))
        closeCombo();
    updateNameNote(area);
    bodyEl.placeholder = general
        ? 'Add more detail if it helps.'
        : formAction === 'add'
            ? 'Why should this be added?'
            : formAction === 'update'
                ? 'What should change, and why?'
                : 'Why should this be removed?';
    const name = nameEl.value.replace(/\s+/g, ' ').trim();
    previewEl.innerHTML =
        name && !general
            ? `Will be posted as <strong>${escapeHtml(suggestionTitle(formAction, area, name))}</strong>`
            : '';
    bodyCountEl.textContent = `${bodyEl.value.length}/${SUGGESTION_LIMITS.reason.max}`;
}
function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
}
actionGroupEl.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    const value = chip?.dataset.value;
    if (!chip || !value || !SUGGESTION_ACTIONS.includes(value))
        return;
    formAction = value;
    for (const other of $$('.chip', actionGroupEl)) {
        const active = other === chip;
        other.classList.toggle('active', active);
        other.setAttribute('aria-checked', String(active));
    }
    updateFormHints();
});
for (const el of [areaEl, nameEl, bodyEl])
    el.addEventListener('input', updateFormHints);
areaEl.addEventListener('change', () => {
    nameEl.value = '';
    updateFormHints();
});
function readForm() {
    const area = areaEl.value;
    const existing = area === 'general' ? undefined : findExisting(area, nameEl.value);
    return {
        action: area === 'general' ? null : formAction,
        area,
        name: existing?.name ?? nameEl.value,
        body: bodyEl.value,
    };
}
function clearForm() {
    nameEl.value = '';
    bodyEl.value = '';
    updateFormHints();
}
formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitEl.disabled)
        return;
    const checked = validateSuggestion(readForm());
    if (!checked.ok) {
        showError(checked.message);
        return;
    }
    showError('');
    submitEl.disabled = true;
    const result = await postSuggestion(checked.value);
    submitEl.disabled = !serverAvailable;
    if (!result.ok) {
        showError(result.status === 0 ? 'The server is unreachable. Try again shortly.' : result.error);
        return;
    }
    const created = result.data.suggestion;
    all.push(created);
    clearForm();
    searchEl.value = '';
    areaFilterEl.value = '';
    actionFilterEl.value = '';
    applyFilters();
    // A fresh suggestion has no votes, so it may sit beyond the first page.
    const position = visible.findIndex((s) => s.id === created.id);
    if (position >= shown) {
        shown = position + 1;
        render();
    }
    toast('Suggestion posted — thanks!');
    const card = listEl.querySelector(`.suggest-card[data-id="${created.id}"]`);
    card?.classList.add('flash');
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function load() {
    const result = await fetchSuggestions();
    loaded = true;
    if (result.ok) {
        all = result.data.suggestions;
    }
    else {
        serverAvailable = false;
        submitEl.disabled = true;
        showError('Suggestions need the FindMyKZ server, which is not reachable.');
    }
    applyFilters();
}
updateFormHints();
render();
void load();
//# sourceMappingURL=suggestions.js.map