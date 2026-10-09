import { gameKey, isBetterDeal, toGame } from './game-mapping';
import { dealDto } from './game.fixtures';
import { Game } from './game.models';

const game = (id: string, salePrice: number, savings = 0): Game => ({
  ...toGame(dealDto()),
  id,
  salePrice,
  savings,
});

describe('game-mapping', () => {
  it('builds stable ids: steam:<appid> or cs:<gameID>', () => {
    expect(gameKey('292030', '1')).toBe('steam:292030');
    expect(gameKey(null, '612')).toBe('cs:612');
    expect(gameKey('', '612')).toBe('cs:612');
  });

  it('maps a CheapShark deal row to a Game', () => {
    const g = toGame(dealDto());
    expect(g).toMatchObject({
      id: 'steam:292030',
      cheapSharkId: '332562',
      steamAppId: '292030',
      title: 'The Witcher 3: Wild Hunt Remastered',
      salePrice: 24.99,
      normalPrice: 49.99,
      savings: 50,
      isOnSale: true,
      metacriticScore: 93,
      steamRatingPercent: 96,
      releaseYear: 2015,
    });
  });

  it('treats zero / missing values as unknown', () => {
    const g = toGame(
      dealDto({ steamAppID: null, metacriticScore: '0', steamRatingText: null, steamRatingPercent: '0', releaseDate: 0, isOnSale: '0' }),
    );
    expect(g.id).toBe('cs:332562');
    expect(g.metacriticScore).toBeNull();
    expect(g.steamRatingText).toBeNull();
    expect(g.steamRatingPercent).toBeNull();
    expect(g.releaseYear).toBeNull();
    expect(g.isOnSale).toBe(false);
  });

  it('prefers the cheaper deal, then the larger discount', () => {
    expect(isBetterDeal(game('a', 5), game('a', 10))).toBe(true);
    expect(isBetterDeal(game('a', 10), game('a', 5))).toBe(false);
    expect(isBetterDeal(game('a', 5, 80), game('a', 5, 50))).toBe(true);
  });
});
