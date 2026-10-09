import { compactCount, dealUrl, formatPrice, metacriticTone, steamRatingTone } from './game-format';

describe('game-format', () => {
  it('formats prices', () => {
    expect(formatPrice(24.99)).toBe('$24.99');
    expect(formatPrice(0)).toBe('Free');
  });

  it('bands Metacritic and Steam ratings', () => {
    expect([metacriticTone(93), metacriticTone(60), metacriticTone(30)]).toEqual(['good', 'mixed', 'bad']);
    expect([steamRatingTone(96), steamRatingTone(50), steamRatingTone(20)]).toEqual(['good', 'mixed', 'bad']);
  });

  it('keeps the already-encoded deal id as-is', () => {
    expect(dealUrl('abc%2BDTY%3D')).toBe('https://www.cheapshark.com/redirect?dealID=abc%2BDTY%3D');
  });

  it('compacts large counts', () => {
    expect(compactCount(246507)).toBe('246.5K');
  });
});
