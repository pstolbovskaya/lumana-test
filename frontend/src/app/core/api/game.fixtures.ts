import { CheapSharkDealDto } from './game.models';

export function dealDto(overrides: Partial<CheapSharkDealDto> = {}): CheapSharkDealDto {
  return {
    title: 'The Witcher 3: Wild Hunt  Remastered',
    dealID: 'deal-1',
    storeID: '1',
    gameID: '332562',
    salePrice: '24.99',
    normalPrice: '49.99',
    isOnSale: '1',
    savings: '50.010002',
    metacriticScore: '93',
    steamRatingText: 'Overwhelmingly Positive',
    steamRatingPercent: '96',
    steamRatingCount: '246507',
    steamAppID: '292030',
    releaseDate: 1431993600,
    dealRating: '10.0',
    thumb: 'https://example.com/thumb.jpg',
    ...overrides,
  };
}
