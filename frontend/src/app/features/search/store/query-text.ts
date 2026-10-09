export const MIN_QUERY_LENGTH = 2;

export function normalizeQuery(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenize(query: string): string[] {
  return normalizeQuery(query)
    .split(/[\s,.;:!?"'()[\]{}\-_/\\]+/)
    .filter((w) => w.length > 0);
}

export function isSearchable(query: string): boolean {
  return query.replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_QUERY_LENGTH;
}
