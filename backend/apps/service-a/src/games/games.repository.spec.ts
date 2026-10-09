import { ObjectId } from 'mongodb';
import {
  buildGameFilter,
  buildGameKeysetFilter,
  buildSort,
  DEFAULT_SORT_ORDER,
  EQUALITY_FILTER_KEYS,
  GAME_SORT_FIELDS,
  gameIndexes,
  sortIndexHint,
} from './games.repository';

describe('buildGameFilter', () => {
  it('returns an empty filter by default', () => {
    expect(buildGameFilter({})).toEqual({});
  });

  it('combines text, equality and range filters', () => {
    expect(
      buildGameFilter({
        q: 'counter strike',
        developer: ' Valve ',
        publisher: 'VALVE',
        minPriceCents: 100,
        maxPriceCents: 1999,
        minReviewScore: 80,
        minOwners: 1_000_000,
      }),
    ).toEqual({
      $text: { $search: 'counter strike' },
      developerKey: 'valve',
      publisherKey: 'valve',
      priceCents: { $gte: 100, $lte: 1999 },
      reviewScore: { $gte: 80 },
      ownersMin: { $gte: 1_000_000 },
    });
  });

  it('freeOnly wins over a price range', () => {
    expect(buildGameFilter({ freeOnly: true, minPriceCents: 500 })).toEqual({ priceCents: 0 });
    expect(buildGameFilter({ freeOnly: false, maxPriceCents: 500 })).toEqual({ priceCents: { $lte: 500 } });
  });
});

describe('sorts and indexes', () => {
  const indexes = gameIndexes();
  const indexKeys = indexes.map((i) => Object.entries(i.key as Record<string, unknown>));

  const serves = (
    key: Array<[string, unknown]>,
    sort: Record<string, number>,
    prefix: string[] = [],
  ): boolean => {
    const s = Object.entries(sort);
    if (key.length !== prefix.length + s.length) return false;
    if (!prefix.every((p, i) => key[i][0] === p)) return false;
    const rest = key.slice(prefix.length);
    const same = rest.every(([k, d], i) => k === s[i][0] && d === s[i][1]);
    const flipped = rest.every(([k, d], i) => k === s[i][0] && d === -s[i][1]);
    return same || flipped;
  };

  it.each(GAME_SORT_FIELDS.flatMap((f) => [[f, 'asc'] as const, [f, 'desc'] as const]))(
    'sort %s %s has a matching (sortField, _id) index, also behind each equality filter',
    (field, order) => {
      const sort = buildSort(field, order) as Record<string, number>;
      if (field === '_id') {
        expect(sort).toEqual({ _id: order === 'asc' ? 1 : -1 });
      } else {
        expect(Object.keys(sort)).toEqual([field, '_id']);
        expect(indexKeys.some((k) => serves(k, sort))).toBe(true);
      }
      for (const eq of EQUALITY_FILTER_KEYS) {
        expect(indexKeys.some((k) => serves(k, sort, [eq]))).toBe(true);
      }
    },
  );

  it('has unique index names, a unique appid index and a weighted text index', () => {
    const names = indexes.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(indexes.find((i) => i.name === 'uniq_appid')).toMatchObject({ key: { appid: 1 }, unique: true });
    expect(indexes.find((i) => i.name === 'text_search')?.weights).toEqual({
      name: 10,
      developer: 4,
      publisher: 2,
    });
  });

  it('defaults to "most first" for popularity sorts', () => {
    expect(DEFAULT_SORT_ORDER).toMatchObject({
      ccu: 'desc',
      positive: 'desc',
      reviewScore: 'desc',
      name: 'asc',
    });
  });
});

describe('buildGameKeysetFilter', () => {
  const id = new ObjectId('65f0c0ffee0000000000abcd');
  it('uses a plain range for the unique appid sort (no _id tie-breaker)', () => {
    expect(buildGameKeysetFilter('appid', 'asc', 730, id)).toEqual({ appid: { $gt: 730 } });
    expect(buildGameKeysetFilter('appid', 'desc', 730, id)).toEqual({ appid: { $lt: 730 } });
  });
  it('uses the null-aware (field, _id) keyset for non-unique sorts', () => {
    expect(buildGameKeysetFilter('ccu', 'desc', 5, id)).toEqual({
      $or: [{ ccu: { $lt: 5 } }, { ccu: 5, _id: { $lt: id } }, { ccu: null }],
    });
    expect(buildGameKeysetFilter('_id', 'asc', undefined, id)).toEqual({ _id: { $gt: id } });
  });
});

describe('sortIndexHint', () => {
  const names = new Set([...gameIndexes().map((i) => i.name), '_id_']);
  it.each(GAME_SORT_FIELDS)(
    'hints an existing index for sort %s, with and without equality filters',
    (sortBy) => {
      for (const extra of [
        {},
        { developer: 'Valve' },
        { publisher: 'Valve' },
        { developer: 'a', publisher: 'b' },
      ]) {
        const hint = sortIndexHint({ sortBy, ...extra });
        expect(names.has(hint)).toBe(true);
      }
    },
  );
  it('picks the equality-prefixed index and never hints text queries', () => {
    expect(sortIndexHint({ sortBy: 'ccu' })).toBe('ccu_id');
    expect(sortIndexHint({ sortBy: '_id' })).toBe('_id_');
    expect(sortIndexHint({ sortBy: 'ccu', developer: 'x' })).toBe('developerKey_ccu_id');
    expect(sortIndexHint({ sortBy: '_id', publisher: 'x' })).toBe('publisherKey_id');
    expect(sortIndexHint({ sortBy: 'ccu', q: 'war', developer: 'x' })).toBeUndefined();
  });
});
