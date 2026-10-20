/**
 * Audit diffing.
 *
 * The audit trail stores only the fields that actually changed, as
 * `{ field, from, to }`. Metadata (`id`, `updatedAt`) is never recorded here —
 * `id` identifies the map and `updatedAt` is derived from the event itself.
 */
import { defaultMapRecord } from '../public/js/types.js';

const SAMPLE = defaultMapRecord('map', 'map');

export const AUDITED_FIELDS = Object.keys(SAMPLE).filter(
  (field) => field !== 'id' && field !== 'updatedAt',
);

function canonical(value) {
  // `undefined` and missing keys are the same thing for diffing purposes.
  return value === undefined ? null : value;
}

function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Compare two full records and return only the fields whose value changed. */
export function computeChanges(before, after) {
  const changes = [];
  for (const field of AUDITED_FIELDS) {
    const from = before ? canonical(before[field]) : null;
    const to = after ? canonical(after[field]) : null;
    if (equal(from, to)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Fields set away from their empty default, used to describe a creation
 * (there is no "old" value) and a deletion (there is no "new" value).
 * `Unknown` is the "not recorded yet" sentinel, so it is not treated as a value.
 */
function nonDefaultFields(record) {
  const defaults = defaultMapRecord(record.name || 'map', record.id || 'map');
  const entries = [];
  for (const field of AUDITED_FIELDS) {
    const value = canonical(record[field]);
    if (equal(canonical(defaults[field]), value)) continue;
    if (value === null || value === '' || value === 'Unknown') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    entries.push({ field, value });
  }
  return entries;
}

export function computeInitialChanges(record) {
  return nonDefaultFields(record).map(({ field, value }) => ({ field, from: null, to: value }));
}

export function computeDeletionChanges(record) {
  return nonDefaultFields(record).map(({ field, value }) => ({ field, from: value, to: null }));
}
