import {
  COLOURS,
  LADDER_TYPES,
  MATERIALS,
  PATHS,
  PORTS,
  SCENERY_GROUPS,
  SPECIALS,
  TECH_OPTIONS,
  TIMES_OF_DAY,
  WEATHER,
} from './types.js';
import type { SuggestionArea } from './suggestion-types.js';

/** An existing material type, property or field that a suggestion can target. */
export interface CatalogueItem {
  /** Text placed in the name box. Disambiguated when two items share a name. */
  name: string;
  /** Short description shown beside it in the dropdown. */
  hint: string;
}

type Entry = { name: string; hint: string };

const entries = (hint: string, names: readonly string[]): Entry[] => names.map((name) => ({ name, hint }));

const MATERIAL_ENTRIES: Entry[] = entries('Material type', MATERIALS);

// Filterable map properties, followed by the values they can take.
const PROPERTY_ENTRIES: Entry[] = [
  ...entries('Property', [
    'Material',
    'Global',
    'Props',
    'CKZ top time',
    'VNL top time',
    'TP tier',
    'Pro tier',
    'Headbangers',
    'Ladders',
    'Bhop',
    'Multi',
    'Prekeep',
    'Surfs',
    'Port',
    'Based on',
    'Weather',
    'Scenery',
    'Time of day',
    'Tech',
    'LJ room',
    'LJ block',
    'Ladder room',
    'Path',
    'Special',
    'Bonus',
  ]),
  ...entries('Weather', WEATHER),
  ...SCENERY_GROUPS.flatMap((group) => entries(`Scenery · ${group.label}`, group.tags)),
  ...entries('Time of day', TIMES_OF_DAY),
  ...entries('Path', PATHS),
  ...entries('Special', SPECIALS),
  ...entries('Port', PORTS.filter((port) => port !== 'Unknown')),
  ...entries('Tech', TECH_OPTIONS),
  ...entries('Ladder type', LADDER_TYPES),
  ...entries('Colour', COLOURS),
];

// Detail fields stored on every map record.
const FIELD_ENTRIES: Entry[] = entries('Field', [
  'Map name',
  'Mappers',
  'Description',
  'Notes',
  'Thumbnail',
  'Workshop ID',
  'CS2KZ ID',
  'Catalogue status',
  'Ladder type',
  'Ladder amount',
  'Surf amount',
  'Surf material',
  'Brick colour',
  'Bhop colour',
  'Multi colour',
  'Prekeep colour',
]);

const BY_AREA: Record<Exclude<SuggestionArea, 'general'>, Entry[]> = {
  material: MATERIAL_ENTRIES,
  property: PROPERTY_ENTRIES,
  field: FIELD_ENTRIES,
};

function build(list: Entry[]): CatalogueItem[] {
  const counts = new Map<string, number>();
  for (const { name } of list) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  return list.map(({ name, hint }) => ({
    name: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${hint})` : name,
    hint,
  }));
}

const cache = new Map<SuggestionArea, CatalogueItem[]>();

/** Existing items for an area; empty for `general`. */
export function catalogueFor(area: SuggestionArea): CatalogueItem[] {
  if (area === 'general') return [];
  let items = cache.get(area);
  if (!items) {
    items = build(BY_AREA[area]);
    cache.set(area, items);
  }
  return items;
}
