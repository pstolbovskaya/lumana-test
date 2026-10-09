import { CheapSharkDealDto, Game } from './game.models';

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: string | number | null | undefined): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

export function gameKey(steamAppId: string | null | undefined, cheapSharkId: string): string {
  return steamAppId && /^\d+$/.test(steamAppId) ? `steam:${steamAppId}` : `cs:${cheapSharkId}`;
}

export function toGame(dto: CheapSharkDealDto): Game {
  const steamAppId = dto.steamAppID && /^\d+$/.test(dto.steamAppID) ? dto.steamAppID : null;
  const releaseYear = dto.releaseDate > 0 ? new Date(dto.releaseDate * 1000).getUTCFullYear() : null;
  return {
    id: gameKey(steamAppId, dto.gameID),
    cheapSharkId: dto.gameID,
    steamAppId,
    title: dto.title?.replace(/\s+/g, ' ').trim() || 'Untitled',
    dealId: dto.dealID,
    storeId: dto.storeID,
    salePrice: toNumber(dto.salePrice) ?? 0,
    normalPrice: toNumber(dto.normalPrice) ?? 0,
    savings: Math.round(Math.min(100, Math.max(0, toNumber(dto.savings) ?? 0))),
    isOnSale: dto.isOnSale === '1',
    metacriticScore: positive(dto.metacriticScore),
    steamRatingText: dto.steamRatingText?.trim() || null,
    steamRatingPercent: positive(dto.steamRatingPercent),
    steamRatingCount: positive(dto.steamRatingCount),
    releaseYear,
    thumb: dto.thumb?.trim() || null,
  };
}

export function isBetterDeal(candidate: Game, current: Game): boolean {
  if (candidate.salePrice !== current.salePrice) {
    return candidate.salePrice < current.salePrice;
  }
  return candidate.savings > current.savings;
}
