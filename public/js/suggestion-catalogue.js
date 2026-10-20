import { COLOURS, LADDER_TYPES, MATERIALS, PATHS, PORTS, SCENERY_GROUPS, SPECIALS, TECH_OPTIONS, TIMES_OF_DAY, WEATHER, } from './types.js';
const entries = (hint, names) => names.map((name) => ({ name, hint }));
const MATERIAL_ENTRIES = entries('Material type', MATERIALS);
// Filterable map properties, followed by the values they can take.
const PROPERTY_ENTRIES = [
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
const FIELD_ENTRIES = entries('Field', [
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
const BY_AREA = {
    material: MATERIAL_ENTRIES,
    property: PROPERTY_ENTRIES,
    field: FIELD_ENTRIES,
};
function build(list) {
    const counts = new Map();
    for (const { name } of list)
        counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
    return list.map(({ name, hint }) => ({
        name: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${hint})` : name,
        hint,
    }));
}
const cache = new Map();
/** Existing items for an area; empty for `general`. */
export function catalogueFor(area) {
    if (area === 'general')
        return [];
    let items = cache.get(area);
    if (!items) {
        items = build(BY_AREA[area]);
        cache.set(area, items);
    }
    return items;
}
//# sourceMappingURL=suggestion-catalogue.js.map