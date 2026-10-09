import type { GameData, RawGame } from './game.types';

export type NormalizeResult = { ok: true; value: GameData } | { ok: false; errors: string[] };

const MAX_TEXT = 500;
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

export function buildGameImageUrls(appid: number): { headerImageUrl: string; heroImageUrl: string } {
  return {
    headerImageUrl: `${STEAM_CDN}/${appid}/header.jpg`,
    heroImageUrl: `${STEAM_CDN}/${appid}/library_hero.jpg`,
  };
}

export function parseOwners(value: unknown): { min: number; max: number } | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? { min: value, max: value } : null;
  }
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d[\d,]*)\s*(?:\.\.\s*(\d[\d,]*))?\s*$/.exec(value);
  if (!m) return null;
  const toInt = (s: string): number => Number(s.replace(/,/g, ''));
  const min = toInt(m[1]);
  const max = m[2] === undefined ? min : toInt(m[2]);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) return null;
  return { min, max };
}

const ALIASES = {
  appid: ['appid', 'appId'],
  name: ['name'],
  developer: ['developer'],
  publisher: ['publisher'],
  positive: ['positive'],
  negative: ['negative'],
  owners: ['owners'],
  average_forever: ['average_forever', 'averagePlaytime'],
  median_forever: ['median_forever', 'medianPlaytime'],
  price: ['price', 'priceCents'],
  initialprice: ['initialprice', 'initialPriceCents'],
  discount: ['discount', 'discountPercent'],
  ccu: ['ccu'],
} as const;

type Field = keyof typeof ALIASES;

function pick(raw: RawGame, field: Field): unknown {
  for (const key of ALIASES[field]) {
    if (key in raw) return raw[key];
  }
  return undefined;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && !v.trim());

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return Number.NaN;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function optionalText(raw: RawGame, field: Field, errors: string[]): string | null {
  const v = pick(raw, field);
  if (isBlank(v)) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') {
    errors.push(`${field} must be a string`);
    return null;
  }
  const trimmed = decodeHtmlEntities(v).trim();
  if (trimmed.length > MAX_TEXT) {
    errors.push(`${field} exceeds ${MAX_TEXT} characters`);
    return null;
  }
  return trimmed;
}

interface IntRule {
  missing: number | null;
  max?: number;
}

function intField(raw: RawGame, field: Field, rule: IntRule, errors: string[]): number | null {
  const v = pick(raw, field);
  if (isBlank(v)) return rule.missing;
  const n = toNumber(v);
  const max = rule.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) {
    errors.push(
      rule.max === undefined
        ? `${field} must be a non-negative integer`
        : `${field} must be an integer in [0, ${rule.max}]`,
    );
    return null;
  }
  return n;
}

export function normalizeGame(input: unknown): NormalizeResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['row must be an object'] };
  }
  const raw = input as RawGame;
  const errors: string[] = [];

  const appidRaw = pick(raw, 'appid');
  const appid = typeof appidRaw === 'string' && /^\s*\d+\s*$/.test(appidRaw) ? Number(appidRaw) : appidRaw;
  if (typeof appid !== 'number' || !Number.isSafeInteger(appid) || appid <= 0) {
    errors.push('appid must be a positive integer');
  }

  const name = optionalText(raw, 'name', errors);
  if (!name) errors.push('name is required');

  const developer = optionalText(raw, 'developer', errors);
  const publisher = optionalText(raw, 'publisher', errors);

  const counter: IntRule = { missing: 0 };
  const positive = intField(raw, 'positive', counter, errors) ?? 0;
  const negative = intField(raw, 'negative', counter, errors) ?? 0;
  const totalReviews = positive + negative;

  const owners = parseOwners(pick(raw, 'owners'));
  if (!owners) errors.push('owners must be a range like "20,000 .. 50,000"');

  const value: GameData = {
    appid: appid as number,
    name: name ?? '',
    developer,
    developerKey: developer ? developer.toLowerCase() : null,
    publisher,
    publisherKey: publisher ? publisher.toLowerCase() : null,
    positive,
    negative,
    reviewScore: totalReviews > 0 ? Math.round((positive / totalReviews) * 1000) / 10 : null,
    ownersMin: owners?.min ?? 0,
    ownersMax: owners?.max ?? 0,
    averagePlaytime: intField(raw, 'average_forever', counter, errors) ?? 0,
    medianPlaytime: intField(raw, 'median_forever', counter, errors) ?? 0,
    priceCents: intField(raw, 'price', { missing: null }, errors),
    initialPriceCents: intField(raw, 'initialprice', { missing: null }, errors),
    discountPercent: intField(raw, 'discount', { missing: 0, max: 100 }, errors) ?? 0,
    ccu: intField(raw, 'ccu', counter, errors) ?? 0,
    ...buildGameImageUrls(appid as number),
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
