import { SEARCH_PAGE_SIZE, buildDealsParams, parseTotalPages, sanitizeTitle } from './cheapshark-query';

describe('cheapshark-query', () => {
  it('sanitizes whitespace and control characters, caps length', () => {
    expect(sanitizeTitle('  the \t witcher\u0000 3 ')).toBe('the witcher 3');
    expect(sanitizeTitle('x'.repeat(250)).length).toBe(100);
  });

  it('maps the 1-based app page to a 0-based pageNumber', () => {
    const p1 = new Map(buildDealsParams(' witcher ', 1));
    expect(p1.get('title')).toBe('witcher');
    expect(p1.get('pageNumber')).toBe('0');
    expect(p1.get('pageSize')).toBe(String(SEARCH_PAGE_SIZE));
    expect(p1.get('exact')).toBe('0');
    expect(p1.get('sortBy')).toBe('Reviews');
    expect(new Map(buildDealsParams('witcher', 3)).get('pageNumber')).toBe('2');
  });

  describe('parseTotalPages (header = index of the last page)', () => {
    it('single page of results', () => {
      expect(parseTotalPages('0', 1, 26)).toBe(1);
    });

    it('no results at all', () => {
      expect(parseTotalPages('0', 1, 0)).toBe(0);
    });

    it('many pages', () => {
      expect(parseTotalPages('41', 1, 60)).toBe(42);
      expect(parseTotalPages('41', 42, 12)).toBe(42);
    });

    it('never reports fewer pages than the one just loaded', () => {
      expect(parseTotalPages('0', 2, 5)).toBe(2);
    });

    it('falls back to "maybe one more page" without a usable header', () => {
      expect(parseTotalPages(null, 1, 60)).toBe(2);
      expect(parseTotalPages('', 2, 10)).toBe(2);
      expect(parseTotalPages('abc', 3, 0)).toBe(2);
    });
  });
});
