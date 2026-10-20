/**
 * Shared model for the public suggestions board. Compiled to `public/js` and
 * imported by both the browser and the Node server so validation and headline
 * wording can never drift apart.
 */

export const SUGGESTION_ACTIONS = ['add', 'update', 'remove'] as const;
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number];

/** What a suggestion is about. `general` suggestions are free-form and have no action. */
export const SUGGESTION_AREAS = ['material', 'property', 'field', 'general'] as const;
export type SuggestionArea = (typeof SUGGESTION_AREAS)[number];

export const ACTION_LABELS: Record<SuggestionAction, string> = {
  add: 'Add',
  update: 'Update',
  remove: 'Remove',
};

export const AREA_LABELS: Record<SuggestionArea, string> = {
  material: 'Material type',
  property: 'Property',
  field: 'Field',
  general: 'General',
};

export const SUGGESTION_LIMITS = {
  name: { min: 1, max: 120 },
  reason: { min: 0, max: 280 },
} as const;

export interface SuggestionInput {
  /** `null` for general suggestions. */
  action: SuggestionAction | null;
  area: SuggestionArea;
  /** Material type / property / field name, or the summary of a general suggestion. */
  name: string;
  /** Optional description or reason. */
  body: string;
}

export interface Suggestion {
  id: number;
  action: SuggestionAction | null;
  area: SuggestionArea;
  name: string;
  title: string;
  body: string;
  up: number;
  down: number;
  /** The calling browser's own vote: 1, -1 or 0. */
  myVote: -1 | 0 | 1;
  createdAt: string;
  /** "Example Suggestion" state; set in the database only, never through the API or site. */
  example: boolean;
}

export function suggestionTitle(action: SuggestionAction | null, area: SuggestionArea, name: string): string {
  if (area === 'general' || !action) return name;
  return `${ACTION_LABELS[action]} ${AREA_LABELS[area].toLowerCase()}: ${name}`;
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function clean(value: unknown): string {
  const text = typeof value === 'string' ? value.normalize('NFC') : '';
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type SuggestionValidation =
  | { ok: true; value: SuggestionInput & { title: string } }
  | { ok: false; message: string };

/** Validate and normalise untrusted input. Shared by the form and the API. */
export function validateSuggestion(raw: unknown): SuggestionValidation {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  if (!includes(SUGGESTION_AREAS, input.area)) {
    return { ok: false, message: 'Choose a material type, property, field or general.' };
  }
  const area = input.area;

  let action: SuggestionAction | null = null;
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
