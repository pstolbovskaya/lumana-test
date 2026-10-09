import ExcelJS from 'exceljs';
import { DatasetParseError, SourceRecord } from './record-source';

type CellPrimitive = string | number | boolean | null;

export function normalizeCellValue(value: unknown): CellPrimitive {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as {
      result?: unknown;
      richText?: Array<{ text: string }>;
      text?: unknown;
      error?: string;
    };
    if ('result' in v) return normalizeCellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return normalizeCellValue(v.text);
    if (v.error) return null;
    return JSON.stringify(value);
  }
  return typeof value === 'bigint' ? value.toString() : null;
}

export function rowToRecord(
  headers: readonly (string | null)[],
  values: readonly unknown[],
): Record<string, CellPrimitive> | null {
  const record: Record<string, CellPrimitive> = {};
  let hasValue = false;
  headers.forEach((h, idx) => {
    if (!h) return;
    const v = normalizeCellValue(values[idx]);
    if (v !== null && v !== '') hasValue = true;
    record[h] = v;
  });
  return hasValue ? record : null;
}

export async function* parseXlsxFile(path: string): AsyncGenerator<SourceRecord> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    entries: 'ignore',
  });
  let headers: (string | null)[] | null = null;
  try {
    for await (const worksheet of reader) {
      for await (const row of worksheet as AsyncIterable<ExcelJS.Row>) {
        const values = row.values as unknown[];
        if (!headers) {
          headers = values.map((v) => {
            const h = normalizeCellValue(v);
            return h === null ? null : String(h).trim() || null;
          });
          continue;
        }
        const record = rowToRecord(headers, values);
        if (record) yield { row: row.number, record };
      }
      break;
    }
  } catch (err) {
    throw new DatasetParseError(`Malformed XLSX: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!headers) throw new DatasetParseError('XLSX file has no header row');
}
