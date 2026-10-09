import { buildGameImageUrls, decodeHtmlEntities, normalizeGame, parseOwners } from './game.normalizer';

const cs2 = {
  appid: 730,
  name: 'Counter-Strike 2',
  developer: 'Valve',
  publisher: 'Valve',
  score_rank: '',
  positive: 7642084,
  negative: 1173003,
  userscore: 0,
  owners: '100,000,000 .. 200,000,000',
  average_forever: 33180,
  average_2weeks: 773,
  median_forever: 6110,
  median_2weeks: 287,
  price: '0',
  initialprice: '0',
  discount: '0',
  ccu: 1013936,
};

describe('parseOwners', () => {
  it.each([
    ['100,000,000 .. 200,000,000', { min: 100_000_000, max: 200_000_000 }],
    ['0 .. 20,000', { min: 0, max: 20_000 }],
    ['  20,000..50,000 ', { min: 20_000, max: 50_000 }],
    ['5000', { min: 5000, max: 5000 }],
    [12345, { min: 12345, max: 12345 }],
  ])('parses %p', (input, expected) => {
    expect(parseOwners(input)).toEqual(expected);
  });

  it.each([['50,000 .. 20,000'], ['lots'], [''], [',,'], ['1 .. 2 .. 3'], [-5], [1.5], [null], [undefined]])(
    'rejects %p',
    (input) => {
      expect(parseOwners(input)).toBeNull();
    },
  );
});

describe('decodeHtmlEntities', () => {
  it('decodes the entities SteamSpy sends, once', () => {
    expect(decodeHtmlEntities('EA Canada &amp; EA Romania')).toBe('EA Canada & EA Romania');
    expect(decodeHtmlEntities('&quot;A&quot; &#39;B&#39; &#x2122; &lt;C&gt;')).toBe('"A" \'B\' \u2122 <C>');
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
    expect(decodeHtmlEntities('Tom & Jerry &unknown; &#0;')).toBe('Tom & Jerry &unknown; &#0;');
  });

  it('makes JSON (escaped) and XLSX (unescaped) rows normalise identically', () => {
    const json = normalizeGame({ appid: 1, name: 'A', publisher: 'X &amp; Y', owners: '0 .. 1' });
    const xlsx = normalizeGame({ appid: 1, name: 'A', publisher: 'X & Y', owners: '0 .. 1' });
    expect(json).toEqual(xlsx);
    expect(json).toMatchObject({ value: { publisher: 'X & Y', publisherKey: 'x & y' } });
  });
});

describe('buildGameImageUrls', () => {
  it('builds the Steam CDN header and hero URLs from the app id', () => {
    expect(buildGameImageUrls(730)).toEqual({
      headerImageUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg',
      heroImageUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_hero.jpg',
    });
  });
});

describe('normalizeGame', () => {
  it('normalises a real SteamSpy row', () => {
    const r = normalizeGame(cs2);
    expect(r).toEqual({
      ok: true,
      value: {
        appid: 730,
        name: 'Counter-Strike 2',
        developer: 'Valve',
        developerKey: 'valve',
        publisher: 'Valve',
        publisherKey: 'valve',
        positive: 7642084,
        negative: 1173003,
        reviewScore: 86.7,
        ownersMin: 100_000_000,
        ownersMax: 200_000_000,
        averagePlaytime: 33180,
        medianPlaytime: 6110,
        priceCents: 0,
        initialPriceCents: 0,
        discountPercent: 0,
        ccu: 1013936,
        headerImageUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg',
        heroImageUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_hero.jpg',
      },
    });
  });

  it('coerces spreadsheet strings and defaults missing counters', () => {
    const r = normalizeGame({
      appid: '42',
      name: ' Game ',
      owners: '0 .. 20,000',
      price: '999',
      developer: '',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      appid: 42,
      name: 'Game',
      developer: null,
      developerKey: null,
      positive: 0,
      negative: 0,
      reviewScore: null,
      priceCents: 999,
      initialPriceCents: null,
      discountPercent: 0,
      ccu: 0,
    });
  });

  it('accepts the normalised (camelCase) shape for hand-made uploads', () => {
    const r = normalizeGame({ appId: 7, name: 'X', owners: '1 .. 2', priceCents: 500, discountPercent: 50 });
    expect(r).toMatchObject({ ok: true, value: { appid: 7, priceCents: 500, discountPercent: 50 } });
  });

  it('collects every error of a bad row', () => {
    const r = normalizeGame({
      appid: -1,
      name: '   ',
      owners: 'many',
      positive: 'NaN',
      negative: -3,
      ccu: Infinity,
      price: '9.99',
      discount: 150,
      developer: { nested: true },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'appid must be a positive integer',
        'name is required',
        'developer must be a string',
        'positive must be a non-negative integer',
        'negative must be a non-negative integer',
        'owners must be a range like "20,000 .. 50,000"',
        'price must be a non-negative integer',
        'discount must be an integer in [0, 100]',
        'ccu must be a non-negative integer',
      ]),
    );
  });

  it('rejects rows without owners and non-objects', () => {
    expect(normalizeGame({ appid: 1, name: 'A' })).toEqual({
      ok: false,
      errors: ['owners must be a range like "20,000 .. 50,000"'],
    });
    expect(normalizeGame(null)).toEqual({ ok: false, errors: ['row must be an object'] });
    expect(normalizeGame([1])).toEqual({ ok: false, errors: ['row must be an object'] });
  });

  it('rounds the review score to one decimal', () => {
    const r = normalizeGame({ appid: 1, name: 'A', owners: '0 .. 1', positive: 2, negative: 1 });
    expect(r.ok && r.value.reviewScore).toBe(66.7);
  });
});
