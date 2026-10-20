/**
 * Shared model for the public suggestions board. Compiled to `public/js` and
 * imported by both the browser and the Node server so validation and headline
 * wording can never drift apart.
 */
export const SUGGESTION_ACTIONS = ['add', 'update', 'remove'];
/** What a suggestion is about. `general` suggestions are free-form and have no action. */
export const SUGGESTION_AREAS = ['material', 'property', 'field', 'general'];
export const ACTION_LABELS = {
    add: 'Add',
    update: 'Update',
    remove: 'Remove',
};
export const AREA_LABELS = {
    material: 'Material type',
    property: 'Property',
    field: 'Field',
    general: 'General',
};
export const SUGGESTION_LIMITS = {
    name: { min: 1, max: 120 },
    reason: { min: 0, max: 280 },
};
export function suggestionTitle(action, area, name) {
    if (area === 'general' || !action)
        return name;
    return `${ACTION_LABELS[action]} ${AREA_LABELS[area].toLowerCase()}: ${name}`;
}
function includes(list, value) {
    return typeof value === 'string' && list.includes(value);
}
function clean(value) {
    const text = typeof value === 'string' ? value.normalize('NFC') : '';
    return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Validate and normalise untrusted input. Shared by the form and the API. */
export function validateSuggestion(raw) {
    const input = (raw && typeof raw === 'object' ? raw : {});
    if (!includes(SUGGESTION_AREAS, input.area)) {
        return { ok: false, message: 'Choose a material type, property, field or general.' };
    }
    const area = input.area;
    let action = null;
    if (area !== 'general') {
        if (!includes(SUGGESTION_ACTIONS, input.action)) {
            return { ok: false, message: 'Choose whether to add, update or remove.' };
        }
        action = input.action;
    }
    const name = clean(input.name);
    if (name.length < SUGGESTION_LIMITS.name.min || name.length > SUGGESTION_LIMITS.name.max) {
        return { ok: false, message: `${area === 'general' ? 'Summary' : 'Name'} must be 1–${SUGGESTION_LIMITS.name.max} characters.` };
    }
    const body = clean(input.body);
    if (body.length > SUGGESTION_LIMITS.reason.max) {
        return { ok: false, message: `Keep the description under ${SUGGESTION_LIMITS.reason.max} characters.` };
    }
    return { ok: true, value: { action, area, name, body, title: suggestionTitle(action, area, name) } };
}
//# sourceMappingURL=suggestion-types.js.map