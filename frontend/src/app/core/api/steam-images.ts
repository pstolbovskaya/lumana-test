export const STEAM_CDN_BASE = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

interface GameImageSource {
  steamAppId: string | null;
  thumb: string | null;
}

function isValidAppId(appId: string | null | undefined): appId is string {
  return !!appId && /^\d+$/.test(appId);
}

export function steamHeaderUrl(appId: string): string {
  return `${STEAM_CDN_BASE}/${appId}/header.jpg`;
}

export function steamHeroUrl(appId: string): string {
  return `${STEAM_CDN_BASE}/${appId}/library_hero.jpg`;
}

function unique(urls: (string | null | undefined)[]): string[] {
  return [...new Set(urls.filter((u): u is string => !!u))];
}

export function thumbnailCandidates(game: GameImageSource): string[] {
  return unique([isValidAppId(game.steamAppId) ? steamHeaderUrl(game.steamAppId) : null, game.thumb]);
}

export function heroCandidates(game: GameImageSource): string[] {
  return unique(
    isValidAppId(game.steamAppId)
      ? [steamHeroUrl(game.steamAppId), steamHeaderUrl(game.steamAppId), game.thumb]
      : [game.thumb],
  );
}
