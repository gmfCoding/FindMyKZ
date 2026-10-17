export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function required<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function debounce<F extends (...args: never[]) => void>(fn: F, delay = 250): F {
  let timer: number | undefined;
  return ((...args: Parameters<F>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  }) as F;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatTopTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, seconds);
  const rounded = Math.round(total * 100) / 100;
  const mins = Math.floor(rounded / 60);
  const secs = rounded - mins * 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

/** Accepts `1:23.45`, `1:23`, or a decimal number of minutes (`1.5`). */
export function parseTopTimeInput(raw: string): { seconds: number | null; valid: boolean } {
  const input = raw.trim();
  if (!input) return { seconds: null, valid: true };
  if (input.includes(':')) {
    const parts = input.split(':');
    if (parts.length > 3) return { seconds: null, valid: false };
    const nums = parts.map((part) => Number(part.trim()));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { seconds: null, valid: false };
    const seconds = nums.reduce((acc, part) => acc * 60 + part, 0);
    return { seconds, valid: true };
  }
  const minutes = Number(input);
  if (!Number.isFinite(minutes) || minutes < 0) return { seconds: null, valid: false };
  return { seconds: minutes * 60, valid: true };
}

export function formatMinutes(value: number | null): string {
  if (value == null) return 'Any';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}m`;
}

export function formatRange(min: number | null, max: number | null, unit = ''): string {
  if (min == null && max == null) return '';
  if (min != null && max != null) return `${min}${unit}–${max}${unit}`;
  if (min != null) return `${min}${unit}+`;
  return `< ${max}${unit}`;
}

export function plural(count: number, singular: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? singular : pluralWord ?? `${singular}s`}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function uid(prefix = 'map'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** VS Code-ish fuzzy scoring. Returns null when not every character matches. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();
  if (t === q) return 1200;
  if (t.startsWith(q)) return 1000 - Math.min(200, t.length - q.length);
  const index = t.indexOf(q);
  if (index >= 0) {
    let bonus = 700 - index * 2;
    if (index === 0 || /[\s\-_/.]/.test(t[index - 1])) bonus += 80;
    return bonus;
  }
  // Subsequence match with word-boundary and consecutive-character bonuses.
  let ti = 0;
  let last = -2;
  let streak = 0;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === last + 1 ? streak + 1 : 0;
    score += 12 + streak * 6;
    if (found === 0 || /[\s\-_/.]/.test(t[found - 1])) score += 18;
    last = found;
    ti = found + 1;
  }
  return score - Math.min(100, t.length - q.length);
}

export function bestFuzzy<T>(
  query: string,
  items: T[],
  text: (item: T) => string[],
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    let score: number | null = null;
    for (const candidate of text(item)) {
      const s = fuzzyScore(query, candidate);
      if (s != null && (score == null || s > score)) score = s;
    }
    if (score != null && (best == null || score > best.score)) best = { item, score };
  }
  return best;
}

export function matchesAllTokens(query: string, haystack: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hay = haystack.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

export function encodeState(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function decodeState<T>(encoded: string): T | null {
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic gradient accent for maps without a thumbnail. */
export function thumbStyle(name: string): string {
  const hash = hashString(name || 'map');
  const hue = hash % 360;
  const hue2 = (hue + 35 + (hash % 70)) % 360;
  return `--thumb-h: ${hue}; --thumb-h2: ${hue2};`;
}

export function mapInitials(name: string): string {
  const cleaned = name.replace(/^kz[_-]?/i, '');
  const letters = cleaned.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 3) || 'KZ').toUpperCase();
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 9);
}
