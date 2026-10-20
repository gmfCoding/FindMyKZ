/** Shared data model for FindMyKZ. Keep this in sync with Property.txt. */
export const COLOURS = [
    'Red',
    'Orange',
    'Yellow',
    'Green',
    'Blue',
    'Purple-Pink',
    'Brown',
    'Gray',
    'White',
    'Black',
    'Rainbow',
    'Multi-Colour',
];
export const MATERIALS = ['Concrete', 'Grass', 'Wood', 'Plastic', 'Rainbow'];
export const AMOUNTS = ['None', 'Some', 'Lots', 'All'];
export const LADDER_TYPES = ['Prop', 'Brush-Mesh', 'Inset', 'Rope'];
export const PORTS = ['GO', 'Source', '1.6', 'Unknown'];
export const WEATHER = [
    'Winter',
    'Summer',
    'Spring',
    'Autumn',
    'Cloudy',
    'Sunny',
    'Raining',
    'Snowing',
    'Snow',
    'Windy',
];
export const SCENERY_GROUPS = [
    {
        label: 'Setting',
        tags: ['Confined', 'Indoors', 'Outdoors', 'Outerspace'],
    },
    {
        label: 'Indoor Settings',
        tags: ['Laboratory', 'Temple', 'Factory', 'Warehouse', 'Dungeon', 'Office', 'Residential', 'Castle'],
    },
    {
        label: 'Outdoor Settings',
        tags: ['Island', 'Canyon', 'Volcano', 'Desert', 'Oasis', 'Graveyard'],
    },
    {
        label: 'Biomes & Nature',
        tags: [
            'Beach',
            'Water',
            'Lava',
            'Acid',
            'Trees',
            'Forest',
            'Mountain',
            'Snowy',
            'Swamp',
            'Cave',
            'Jungle',
            'Tundra',
        ],
    },
    {
        label: 'Urban & Architecture',
        tags: [
            'Industrial',
            'Cityscape',
            'Ruins',
            'Cyberpunk',
            'Medieval',
            'Post-Apocalyptic',
            'Suburban',
            'Underground',
            'Abstract',
        ],
    },
    {
        label: 'Art Style',
        tags: ['Realistic', 'Low Poly', 'Futuristic'],
    },
    {
        label: 'Climate & Tone',
        tags: ['Warm', 'Neutral', 'Cold'],
    },
    {
        label: 'Atmosphere & Lighting',
        tags: ['Daytime', 'Nighttime', 'Sunset', 'Foggy', 'Spooky', 'Surreal', 'Neon', 'Monochrome'],
    },
    {
        label: 'Gameplay & Hazards',
        tags: ['Toxic', 'Void', 'Ice', 'Floating Islands'],
    },
];
export const SCENERY = SCENERY_GROUPS.flatMap((group) => [...group.tags]);
export const TIMES_OF_DAY = ['Dawn', 'Dusk', 'Day', 'Night'];
export const PATHS = ['Linear', 'Circular', 'Spiral', 'Staged', 'Locked'];
export const SPECIALS = [
    'Boosters',
    'Wall Jumps',
    'Jump Pads',
    'Water',
    'Slides',
    'Gravity',
    'Turbines',
    'Crouch',
];
export const TRI_OPTIONS = ['Yes', 'No'];
export const LJ_BLOCK_OPTIONS = ['Yes', 'No', 'Specific'];
export const TECH_OPTIONS = ['Box Tech'];
/**
 * Catalogue status: has every property of the map been fully verified?
 * Every map starts as `Uncatalogued` until someone marks it complete.
 */
export const CATALOGUE_STATES = ['Catalogued', 'Uncatalogued'];
export const SORT_OPTIONS = [
    { value: 'name', label: 'Name (A–Z)' },
    { value: 'top-asc', label: 'Top time (fast → slow)' },
    { value: 'top-desc', label: 'Top time (slow → fast)' },
    { value: 'tier-asc', label: 'TP tier (easy → hard)' },
    { value: 'tier-desc', label: 'TP tier (hard → easy)' },
    { value: 'recent', label: 'Recently updated' },
];
export const TOP_TIME_PRESETS = [
    { label: '< 1m', min: null, max: 1 },
    { label: '1–2m', min: 1, max: 2 },
    { label: '2–3m', min: 2, max: 3 },
    { label: '3–5m', min: 3, max: 5 },
    { label: '5–10m', min: 5, max: 10 },
    { label: '10–20m', min: 10, max: 20 },
    { label: '20m+', min: 20, max: null },
];
export const DEFAULT_FILTERS = {
    q: '',
    global: [],
    materials: [],
    materialsMode: 'all',
    props: [],
    topMin: null,
    topMax: null,
    vnlTopMin: null,
    vnlTopMax: null,
    tpMin: null,
    tpMax: null,
    proMin: null,
    proMax: null,
    headbangers: [],
    ladderAmount: [],
    ladderTypes: [],
    bhop: [],
    bhopColour: null,
    multi: [],
    multiColour: null,
    prekeep: [],
    prekeepColour: null,
    surfAmounts: [],
    surfMaterials: [],
    ports: [],
    basedOn: '',
    weather: [],
    scenery: [],
    timeOfDay: [],
    tech: [],
    ljRoom: [],
    ljBlock: [],
    ladderRoom: [],
    path: [],
    special: [],
    bonus: [],
    catalogued: [],
};
export function defaultMapRecord(name = '', id = '') {
    return {
        id: id || name || `map-${Date.now()}`,
        name,
        global: 'Unknown',
        materials: [],
        props: [],
        topTime: null,
        vnlTopTime: null,
        tpTier: null,
        proTier: null,
        headbangers: 'Unknown',
        ladderAmount: [],
        ladderTypes: [],
        bhop: 'Unknown',
        bhopColour: null,
        multi: 'Unknown',
        multiColour: null,
        prekeep: 'Unknown',
        prekeepColour: null,
        surfAmounts: [],
        surfMaterials: [],
        port: 'Unknown',
        basedOn: '',
        weather: [],
        scenery: [],
        timeOfDay: [],
        tech: [],
        ljRoom: 'Unknown',
        ljBlock: 'Unknown',
        ladderRoom: 'Unknown',
        path: [],
        special: [],
        bonus: 'No',
        catalogued: 'Uncatalogued',
        mappers: '',
        description: '',
        thumbnail: null,
        workshopId: null,
        cs2kzId: null,
        updatedAt: new Date().toISOString(),
    };
}
/** Labels used by the filter chips and detail view. */
export const FILTER_LABELS = {
    q: 'Name',
    global: 'Global',
    materials: 'Material',
    materialsMode: 'Material match',
    props: 'Props',
    top: 'CKZ top time',
    vnlTop: 'VNL top time',
    tp: 'TP tier',
    pro: 'Pro tier',
    headbangers: 'Headbangers',
    ladderAmount: 'Ladders',
    ladderTypes: 'Ladder type',
    bhop: 'Bhop',
    bhopColour: 'Bhop colour',
    multi: 'Multi',
    multiColour: 'Multi colour',
    prekeep: 'Prekeep',
    prekeepColour: 'Prekeep colour',
    surfAmounts: 'Surf amount',
    surfMaterials: 'Surf material',
    ports: 'Port',
    basedOn: 'Based on',
    weather: 'Weather',
    scenery: 'Scenery',
    timeOfDay: 'Time',
    tech: 'Tech',
    ljRoom: 'LJ room',
    ljBlock: 'LJ block',
    ladderRoom: 'Ladder room',
    path: 'Path',
    special: 'Special',
    bonus: 'Bonus',
    catalogued: 'Catalogue',
};
//# sourceMappingURL=types.js.map