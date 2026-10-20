/** Shared data model for FindMyKZ. Keep this in sync with Property.txt. */

export type Tri = 'Yes' | 'No' | 'Unknown';
export type LjBlockValue = 'Yes' | 'No' | 'Specific' | 'Unknown';
export type AnyAll = 'any' | 'all';

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
] as const;
export type Colour = (typeof COLOURS)[number];

export const MATERIALS = ['Concrete', 'Grass', 'Wood', 'Plastic', 'Rainbow'] as const;
export type Material = (typeof MATERIALS)[number];

export const AMOUNTS = ['None', 'Some', 'Lots', 'All'] as const;
export type Amount = (typeof AMOUNTS)[number];

export const LADDER_TYPES = ['Prop', 'Brush-Mesh', 'Inset', 'Rope'] as const;
export type LadderType = (typeof LADDER_TYPES)[number];

export const PORTS = ['GO', 'Source', '1.6', 'Unknown'] as const;
export type Port = (typeof PORTS)[number];

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
] as const;
export type Weather = (typeof WEATHER)[number];

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
] as const;

export type Scenery = (typeof SCENERY_GROUPS)[number]['tags'][number];
export const SCENERY: readonly Scenery[] = SCENERY_GROUPS.flatMap((group) => [...group.tags]);

export const TIMES_OF_DAY = ['Dawn', 'Dusk', 'Day', 'Night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const PATHS = ['Linear', 'Circular', 'Spiral', 'Staged', 'Locked'] as const;
export type PathTag = (typeof PATHS)[number];

export const SPECIALS = [
  'Boosters',
  'Wall Jumps',
  'Jump Pads',
  'Water',
  'Slides',
  'Gravity',
  'Turbines',
  'Crouch',
] as const;
export type Special = (typeof SPECIALS)[number];

export const TRI_OPTIONS: readonly Tri[] = ['Yes', 'No'];
export const LJ_BLOCK_OPTIONS: readonly LjBlockValue[] = ['Yes', 'No', 'Specific'];
export const TECH_OPTIONS = ['Box Tech'] as const;

export interface MapRecord {
  id: string;
  name: string;
  global: Tri;
  materials: Material[];
  props: Amount[];
  /** Top time in seconds for classic / CKZ. `null` = unknown. */
  topTime: number | null;
  /** Top time in seconds for vanilla / VNL. `null` = unknown. */
  vnlTopTime: number | null;
  tpTier: number | null;
  proTier: number | null;
  headbangers: Tri;
  ladderAmount: Amount[];
  ladderTypes: LadderType[];
  bhop: Tri;
  bhopColour: Colour | null;
  multi: Tri;
  multiColour: Colour | null;
  prekeep: Tri;
  prekeepColour: Colour | null;
  surfAmounts: Amount[];
  surfMaterials: Material[];
  port: Port;
  basedOn: string;
  weather: Weather[];
  scenery: Scenery[];
  timeOfDay: TimeOfDay[];
  tech: string[];
  ljRoom: Tri;
  ljBlock: LjBlockValue;
  ladderRoom: Tri;
  path: PathTag[];
  special: Special[];
  bonus: Tri;
  mappers: string;
  description: string;
  thumbnail: string | null;
  workshopId: string | null;
  cs2kzId: number | null;
  updatedAt: string;
  /** Free-form notes, kept in the data file but not searchable. */
  notes?: string;
}

export interface MapDataset {
  version: number;
  updatedAt: string;
  maps: MapRecord[];
}

export interface SearchFilters {
  q: string;
  global: Tri[];
  materials: Material[];
  materialsMode: AnyAll;
  props: Amount[];
  /** Minutes. `null` = unbounded. */
  topMin: number | null;
  topMax: number | null;
  /** VNL top-time range, in minutes. */
  vnlTopMin: number | null;
  vnlTopMax: number | null;
  tpMin: number | null;
  tpMax: number | null;
  proMin: number | null;
  proMax: number | null;
  headbangers: Tri[];
  ladderAmount: Amount[];
  ladderTypes: LadderType[];
  bhop: Tri[];
  bhopColour: Colour | null;
  multi: Tri[];
  multiColour: Colour | null;
  prekeep: Tri[];
  prekeepColour: Colour | null;
  surfAmounts: Amount[];
  surfMaterials: Material[];
  ports: Port[];
  basedOn: string;
  weather: Weather[];
  scenery: Scenery[];
  timeOfDay: TimeOfDay[];
  tech: string[];
  ljRoom: Tri[];
  ljBlock: LjBlockValue[];
  ladderRoom: Tri[];
  path: PathTag[];
  special: Special[];
  bonus: Tri[];
}

export type SortKey = 'name' | 'top-asc' | 'top-desc' | 'tier-asc' | 'tier-desc' | 'recent';

/** Minimal shape of the public cs2kz.org map lookup response. */
export interface Cs2kzCourseFilters {
  nub_tier?: string | null;
  pro_tier?: string | null;
  state?: string | null;
}

export interface Cs2kzCourse {
  name: string;
  description?: string | null;
  filters?: {
    vanilla?: Cs2kzCourseFilters | null;
    classic?: Cs2kzCourseFilters | null;
  } | null;
}

export interface Cs2kzLookupMap {
  id: number;
  workshop_id: number | string;
  name: string;
  description?: string | null;
  state?: string | null;
  mappers?: { id?: string; name: string }[];
  courses?: Cs2kzCourse[];
  approved_at?: string | null;
}

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'top-asc', label: 'Top time (fast → slow)' },
  { value: 'top-desc', label: 'Top time (slow → fast)' },
  { value: 'tier-asc', label: 'TP tier (easy → hard)' },
  { value: 'tier-desc', label: 'TP tier (hard → easy)' },
  { value: 'recent', label: 'Recently updated' },
];

export const TOP_TIME_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: '< 1m', min: null, max: 1 },
  { label: '1–2m', min: 1, max: 2 },
  { label: '2–3m', min: 2, max: 3 },
  { label: '3–5m', min: 3, max: 5 },
  { label: '5–10m', min: 5, max: 10 },
  { label: '10–20m', min: 10, max: 20 },
  { label: '20m+', min: 20, max: null },
];

export const DEFAULT_FILTERS: SearchFilters = {
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
};

export function defaultMapRecord(name = '', id = ''): MapRecord {
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
    mappers: '',
    description: '',
    thumbnail: null,
    workshopId: null,
    cs2kzId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Labels used by the filter chips and detail view. */
export const FILTER_LABELS: Record<string, string> = {
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
};
