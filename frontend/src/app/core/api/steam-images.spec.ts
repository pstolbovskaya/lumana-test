import { heroCandidates, steamHeaderUrl, steamHeroUrl, thumbnailCandidates } from './steam-images';

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

describe('steam-images', () => {
  it('builds the shared CDN urls', () => {
    expect(steamHeaderUrl('292030')).toBe(`${CDN}/292030/header.jpg`);
    expect(steamHeroUrl('292030')).toBe(`${CDN}/292030/library_hero.jpg`);
  });

  it('list thumbnail: Steam header first, CheapShark thumb as fallback', () => {
    expect(thumbnailCandidates({ steamAppId: '20920', thumb: 'https://t/x.jpg' })).toEqual([
      `${CDN}/20920/header.jpg`,
      'https://t/x.jpg',
    ]);
  });

  it('dialog image: hero -> header -> thumb', () => {
    expect(heroCandidates({ steamAppId: '20920', thumb: 'https://t/x.jpg' })).toEqual([
      `${CDN}/20920/library_hero.jpg`,
      `${CDN}/20920/header.jpg`,
      'https://t/x.jpg',
    ]);
  });

  it('non-Steam games only use the CheapShark thumb', () => {
    expect(thumbnailCandidates({ steamAppId: null, thumb: 'https://t/y.jpg' })).toEqual(['https://t/y.jpg']);
    expect(heroCandidates({ steamAppId: null, thumb: 'https://t/y.jpg' })).toEqual(['https://t/y.jpg']);
  });

  it('ignores invalid app ids and missing thumbs', () => {
    expect(heroCandidates({ steamAppId: '../evil', thumb: null })).toEqual([]);
    expect(thumbnailCandidates({ steamAppId: null, thumb: null })).toEqual([]);
  });
});
