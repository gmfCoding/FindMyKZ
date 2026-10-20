import type { MapRecord, SearchFilters, SortKey, Tri } from './types.js';
import { DEFAULT_FILTERS, FILTER_LABELS } from './types.js';
import { formatRange } from './util.js';

function intersects<T extends string>(selected: readonly T[], values: readonly T[]): boolean {
  if (selected.length === 0) return true;
  return values.some((value) => selected.includes(value));
}

function everySelected<T extends string>(selected: readonly T[], values: readonly T[]): boolean {
  if (selected.length === 0) return true;
  return selected.every((value) => values.includes(value));
}

function matchesTri(selected: readonly Tri[], value: Tri): boolean {
  return selected.length === 0 || selected.includes(value);
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function textContains(haystack: string | null | undefined, needle: string): boolean {
  if (!needle.trim()) return true;
  return (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase());
}

/** True once any property beyond the cs2kz metadata has been entered. */
export function hasManualProperties(map: MapRecord): boolean {
  return (
    map.materials.length > 0 ||
    map.props.length > 0 ||
    map.topTime != null ||
    map.headbangers !== 'Unknown' ||
    map.ladderAmount.length > 0 ||
    map.ladderTypes.length > 0 ||
    map.bhop !== 'Unknown' ||
    map.multi !== 'Unknown' ||
    map.prekeep !== 'Unknown' ||
    map.surfAmounts.length > 0 ||
    map.surfMaterials.length > 0 ||
    map.port !== 'Unknown' ||
    map.basedOn.trim() !== '' ||
    map.weather.length > 0 ||
    map.scenery.length > 0 ||
    map.timeOfDay.length > 0 ||
    map.tech.length > 0 ||
    map.ljRoom !== 'Unknown' ||
    map.ljBlock !== 'Unknown' ||
    map.ladderRoom !== 'Unknown' ||
    map.path.length > 0 ||
    map.special.length > 0 ||
    map.bonus !== 'Unknown' ||
    map.catalogued === 'Catalogued'
  );
}

export function filterMaps(maps: MapRecord[], filters: SearchFilters): MapRecord[] {  const q = filters.q.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const topMinSeconds = filters.topMin == null ? null : filters.topMin * 60;
  const topMaxSeconds = filters.topMax == null ? null : filters.topMax * 60;
  const vnlMinSeconds = filters.vnlTopMin == null ? null : filters.vnlTopMin * 60;
  const vnlMaxSeconds = filters.vnlTopMax == null ? null : filters.vnlTopMax * 60;

  return maps.filter((map) => {
    if (tokens.length > 0) {
      const haystack = [map.name, map.mappers, map.basedOn, map.description, ...map.tech]
        .join(' ')
        .toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }

    if (!matchesTri(filters.global, map.global)) return false;

    if (filters.materials.length > 0) {
      if (filters.materialsMode === 'all') {
        if (!filters.materials.every((material) => map.materials.includes(material))) return false;
      } else if (!intersects(filters.materials, map.materials)) {
        return false;
      }
    }

    if (filters.brickColour) {
      if (!map.materials.includes('Brick') || map.brickColour !== filters.brickColour) return false;
    }

    if (!intersects(filters.props, map.props)) return false;
    if (!inRange(map.topTime, topMinSeconds, topMaxSeconds)) return false;
    if (!inRange(map.vnlTopTime, vnlMinSeconds, vnlMaxSeconds)) return false;
    if (!inRange(map.tpTier, filters.tpMin, filters.tpMax)) return false;
    if (!inRange(map.proTier, filters.proMin, filters.proMax)) return false;
    if (!matchesTri(filters.headbangers, map.headbangers)) return false;
    if (!intersects(filters.ladderAmount, map.ladderAmount)) return false;
    if (!intersects(filters.ladderTypes, map.ladderTypes)) return false;

    if (!matchesTri(filters.bhop, map.bhop)) return false;
    if (filters.bhopColour && map.bhopColour !== filters.bhopColour) return false;

    if (!matchesTri(filters.multi, map.multi)) return false;
    if (filters.multiColour && map.multiColour !== filters.multiColour) return false;

    if (!matchesTri(filters.prekeep, map.prekeep)) return false;
    if (filters.prekeepColour && map.prekeepColour !== filters.prekeepColour) return false;

    if (!intersects(filters.surfAmounts, map.surfAmounts)) return false;
    if (!intersects(filters.surfMaterials, map.surfMaterials)) return false;
    if (!intersects(filters.ports, [map.port])) return false;
    if (!textContains(map.basedOn, filters.basedOn)) return false;
    if (!intersects(filters.weather, map.weather)) return false;
    if (!intersects(filters.scenery, map.scenery)) return false;
    if (!intersects(filters.timeOfDay, map.timeOfDay)) return false;
    if (filters.tech.length > 0 && !filters.tech.every((tech) => map.tech.includes(tech))) return false;
    if (!matchesTri(filters.ljRoom, map.ljRoom)) return false;
    if (filters.ljBlock.length > 0 && !filters.ljBlock.includes(map.ljBlock)) return false;
    if (!matchesTri(filters.ladderRoom, map.ladderRoom)) return false;
    if (!intersects(filters.path, map.path)) return false;
    if (!intersects(filters.special, map.special)) return false;
    if (!matchesTri(filters.bonus, map.bonus)) return false;
    if (filters.catalogued.length > 0 && !filters.catalogued.includes(map.catalogued)) return false;

    return true;
  });
}

export function sortMaps(maps: MapRecord[], sort: SortKey): MapRecord[] {
  const copy = [...maps];
  switch (sort) {
    case 'top-asc':
      return copy.sort((a, b) => (a.topTime ?? Infinity) - (b.topTime ?? Infinity));
    case 'top-desc':
      return copy.sort((a, b) => (b.topTime ?? -Infinity) - (a.topTime ?? -Infinity));
    case 'tier-asc':
      return copy.sort((a, b) => (a.tpTier ?? 99) - (b.tpTier ?? 99));
    case 'tier-desc':
      return copy.sort((a, b) => (b.tpTier ?? -1) - (a.tpTier ?? -1));
    case 'recent':
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'name':
    default:
      return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
}

export function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.q.trim()) count++;
  if (filters.global.length) count++;
  if (filters.materials.length || filters.brickColour) count++;
  if (filters.props.length) count++;
  if (filters.topMin != null || filters.topMax != null) count++;
  if (filters.vnlTopMin != null || filters.vnlTopMax != null) count++;
  if (filters.tpMin != null || filters.tpMax != null) count++;
  if (filters.proMin != null || filters.proMax != null) count++;
  if (filters.headbangers.length) count++;
  if (filters.ladderAmount.length || filters.ladderTypes.length) count++;
  if (filters.bhop.length || filters.bhopColour) count++;
  if (filters.multi.length || filters.multiColour) count++;
  if (filters.prekeep.length || filters.prekeepColour) count++;
  if (filters.surfAmounts.length || filters.surfMaterials.length) count++;
  if (filters.ports.length) count++;
  if (filters.basedOn.trim()) count++;
  if (filters.weather.length) count++;
  if (filters.scenery.length) count++;
  if (filters.timeOfDay.length) count++;
  if (filters.tech.length) count++;
  if (filters.ljRoom.length) count++;
  if (filters.ljBlock.length) count++;
  if (filters.ladderRoom.length) count++;
  if (filters.path.length) count++;
  if (filters.special.length) count++;
  if (filters.bonus.length) count++;
  if (filters.catalogued.length) count++;
  return count;
}

export interface ActiveFilterChip {
  id: string;
  label: string;
  key: keyof SearchFilters;
  value?: string;
  /** Toggle-style chip (e.g. material mode). */
  subtle?: boolean;
}

const ARRAY_LABEL_KEYS: {
  key: keyof SearchFilters;
  label: string;
}[] = [
  { key: 'global', label: 'Global' },
  { key: 'materials', label: 'Material' },
  { key: 'props', label: 'Props' },
  { key: 'headbangers', label: 'Headbangers' },
  { key: 'ladderAmount', label: 'Ladders' },
  { key: 'ladderTypes', label: 'Ladder type' },
  { key: 'bhop', label: 'Bhop' },
  { key: 'multi', label: 'Multi' },
  { key: 'prekeep', label: 'Prekeep' },
  { key: 'surfAmounts', label: 'Surf' },
  { key: 'surfMaterials', label: 'Surf material' },
  { key: 'ports', label: 'Port' },
  { key: 'weather', label: 'Weather' },
  { key: 'scenery', label: 'Scenery' },
  { key: 'timeOfDay', label: 'Time' },
  { key: 'tech', label: 'Tech' },
  { key: 'ljRoom', label: 'LJ room' },
  { key: 'ljBlock', label: 'LJ block' },
  { key: 'ladderRoom', label: 'Ladder room' },
  { key: 'path', label: 'Path' },
  { key: 'special', label: 'Special' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'catalogued', label: 'Catalogue' },
];

export function activeFilterChips(filters: SearchFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.q.trim()) {
    chips.push({ id: `q`, key: 'q', label: `Name: “${filters.q.trim()}”` });
  }

  for (const { key, label } of ARRAY_LABEL_KEYS) {
    const values = filters[key];
    if (!Array.isArray(values)) continue;
    for (const value of values as string[]) {
      chips.push({
        id: `${String(key)}:${value}`,
        key,
        value,
        label: `${label}: ${value}`,
      });
    }
  }

  if (filters.materials.length > 1) {
    chips.push({
      id: 'materialsMode',
      key: 'materialsMode',
      label: filters.materialsMode === 'all' ? 'Match all materials' : 'Match any materials',
      subtle: true,
    });
  }

  const colourFields: { key: keyof SearchFilters; label: string }[] = [
    { key: 'brickColour', label: 'Brick colour' },
    { key: 'bhopColour', label: 'Bhop colour' },
    { key: 'multiColour', label: 'Multi colour' },
    { key: 'prekeepColour', label: 'Prekeep colour' },
  ];
  for (const { key, label } of colourFields) {
    const value = filters[key];
    if (typeof value === 'string' && value) {
      chips.push({ id: String(key), key, value, label: `${label}: ${value}` });
    }
  }

  if (filters.topMin != null || filters.topMax != null) {
    const range = formatRange(filters.topMin, filters.topMax, 'm');
    chips.push({ id: 'top', key: 'topMin', label: `CKZ top time: ${range}` });
  }
  if (filters.vnlTopMin != null || filters.vnlTopMax != null) {
    const range = formatRange(filters.vnlTopMin, filters.vnlTopMax, 'm');
    chips.push({ id: 'vnlTop', key: 'vnlTopMin', label: `VNL top time: ${range}` });
  }
  if (filters.tpMin != null || filters.tpMax != null) {
    const range = formatRange(filters.tpMin, filters.tpMax);
    chips.push({ id: 'tp', key: 'tpMin', label: `TP tier: ${range}` });
  }
  if (filters.proMin != null || filters.proMax != null) {
    const range = formatRange(filters.proMin, filters.proMax);
    chips.push({ id: 'pro', key: 'proMin', label: `Pro tier: ${range}` });
  }
  if (filters.basedOn.trim()) {
    chips.push({ id: 'basedOn', key: 'basedOn', label: `Based on: “${filters.basedOn.trim()}”` });
  }

  return chips;
}

export function removeFilterChip(filters: SearchFilters, chip: ActiveFilterChip): void {
  switch (chip.id) {
    case 'q':
      filters.q = '';
      return;
    case 'materialsMode':
      filters.materialsMode = filters.materialsMode === 'all' ? 'any' : 'all';
      return;
    case 'top':
      filters.topMin = null;
      filters.topMax = null;
      return;
    case 'vnlTop':
      filters.vnlTopMin = null;
      filters.vnlTopMax = null;
      return;
    case 'tp':
      filters.tpMin = null;
      filters.tpMax = null;
      return;
    case 'pro':
      filters.proMin = null;
      filters.proMax = null;
      return;
    case 'basedOn':
      filters.basedOn = '';
      return;
    case 'brickColour':
    case 'bhopColour':
    case 'multiColour':
    case 'prekeepColour':
      filters[chip.key] = null as never;
      return;
    default:
      break;
  }

  if (Array.isArray(filters[chip.key])) {
    const list = filters[chip.key] as string[];
    const value = chip.value;
    (filters as unknown as Record<string, string[]>)[chip.key] = list.filter((item) => item !== value);
    return;
  }
  if (typeof filters[chip.key] === 'string') {
    (filters as unknown as Record<string, string>)[chip.key] = '';
  }
}

export function clearFilters(filters: SearchFilters): void {
  Object.assign(filters, structuredClone(DEFAULT_FILTERS));
}

export function activeFilterCountLabel(count: number): string {
  return count === 0 ? 'No filters' : `${count} ${count === 1 ? 'filter' : 'filters'}`;
}

export { FILTER_LABELS };
