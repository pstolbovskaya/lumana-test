export interface SourceRecord {
  row: number;
  record: unknown;
}

export type DatasetFormat = 'json' | 'xlsx';

export class DatasetParseError extends Error {}

export function formatFromFileName(name: string): DatasetFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}
