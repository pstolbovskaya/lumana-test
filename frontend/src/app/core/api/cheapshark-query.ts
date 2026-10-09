export const CHEAPSHARK_BASE_URL = 'https://www.cheapshark.com/api/1.0';
export const SEARCH_PAGE_SIZE = 60;
export const SEARCH_SORT = 'Reviews';
export const MAX_TITLE_LENGTH = 100;
export const TOTAL_PAGES_HEADER = 'X-Total-Page-Count';

export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

export function buildDealsParams(raw: string, page: number, pageSize = SEARCH_PAGE_SIZE): [string, string][] {
  return [
    ['title', sanitizeTitle(raw)],
    ['exact', '0'],
    ['sortBy', SEARCH_SORT],
    ['pageSize', String(pageSize)],
    ['pageNumber', String(Math.max(0, page - 1))],
  ];
}

export function parseTotalPages(
  header: string | null,
  page: number,
  rowCount: number,
  pageSize = SEARCH_PAGE_SIZE,
): number {
  const lastIndex = header === null || header.trim() === '' ? NaN : Number(header);
  if (Number.isInteger(lastIndex) && lastIndex >= 0) {
    if (lastIndex === 0 && rowCount === 0 && page === 1) {
      return 0;
    }
    return Math.max(lastIndex + 1, rowCount > 0 ? page : 0);
  }
  if (rowCount === 0) {
    return page - 1;
  }
  return rowCount >= pageSize ? page + 1 : page;
}
