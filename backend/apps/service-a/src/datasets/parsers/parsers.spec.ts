import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatasetParseError, formatFromFileName, parseDatasetFile, SourceRecord } from '.';
import { JsonArrayWriter, XlsxWriter } from '../writers/dataset-writer';
import { normalizeCellValue, rowToRecord } from './xlsx.parser';

async function collect(gen: AsyncIterable<SourceRecord>): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

describe('dataset parsers', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parsers-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects format from file name', () => {
    expect(formatFromFileName('a.JSON')).toBe('json');
    expect(formatFromFileName('a.xlsx')).toBe('xlsx');
    expect(formatFromFileName('a.csv')).toBeNull();
  });

  it('streams a top-level JSON array', async () => {
    const p = join(dir, 'arr.json');
    await writeFile(p, '﻿  [{"id":1},{"id":2},{"id":3}]');
    const rows = await collect(parseDatasetFile(p, 'json'));
    expect(rows).toEqual([
      { row: 1, record: { id: 1 } },
      { row: 2, record: { id: 2 } },
      { row: 3, record: { id: 3 } },
    ]);
  });

  it('streams the data array of an API-shaped object', async () => {
    const p = join(dir, 'obj.json');
    await writeFile(p, JSON.stringify({ pagination: { total: 2 }, data: [{ id: 7 }, { id: 8 }], info: {} }));
    const rows = await collect(parseDatasetFile(p, 'json'));
    expect(rows.map((r) => r.record)).toEqual([{ id: 7 }, { id: 8 }]);
  });

  it('fails with DatasetParseError on malformed JSON (after yielding valid prefix)', async () => {
    const p = join(dir, 'bad.json');
    await writeFile(p, '[{"id":1},{"id":');
    const seen: SourceRecord[] = [];
    await expect(
      (async () => {
        for await (const r of parseDatasetFile(p, 'json')) seen.push(r);
      })(),
    ).rejects.toBeInstanceOf(DatasetParseError);
    expect(seen).toHaveLength(1);
  });

  it('rejects scalar JSON roots', async () => {
    const p = join(dir, 'scalar.json');
    await writeFile(p, '42');
    await expect(collect(parseDatasetFile(p, 'json'))).rejects.toBeInstanceOf(DatasetParseError);
  });

  it('round-trips through the streaming JSON writer', async () => {
    const p = join(dir, 'written.json');
    const w = new JsonArrayWriter(p);
    await Promise.all([w.write({ id: 1 }), w.write({ id: 2, t: 'x,"y"' })]);
    await w.commit();
    const rows = await collect(parseDatasetFile(p, 'json'));
    expect(rows.map((r) => r.record)).toEqual([{ id: 1 }, { id: 2, t: 'x,"y"' }]);
  });

  it('round-trips through the streaming XLSX writer and reader', async () => {
    const p = join(dir, 'written.xlsx');
    const w = new XlsxWriter(p, ['id', 'title', 'is_public_domain', 'date_start']);
    await w.write({ id: 1, title: 'A', is_public_domain: true, date_start: 1900 });
    await w.write({ id: 2, title: 'B', is_public_domain: false, date_start: null });
    await w.commit();
    const rows = await collect(parseDatasetFile(p, 'xlsx'));
    expect(rows).toEqual([
      { row: 2, record: { id: 1, title: 'A', is_public_domain: true, date_start: 1900 } },
      { row: 3, record: { id: 2, title: 'B', is_public_domain: false, date_start: null } },
    ]);
  });

  it('flattens ExcelJS cell value shapes', () => {
    expect(normalizeCellValue({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(normalizeCellValue({ formula: '1+1', result: 2 })).toBe(2);
    expect(normalizeCellValue({ text: 'link', hyperlink: 'http://x' })).toBe('link');
    expect(normalizeCellValue(new Date('2020-01-01T00:00:00Z'))).toBe('2020-01-01T00:00:00.000Z');
    expect(normalizeCellValue({ error: '#N/A' })).toBeNull();
  });

  it('maps rows and skips empty ones', () => {
    expect(rowToRecord([null, 'a', 'b'], [undefined, 1, null])).toEqual({ a: 1, b: null });
    expect(rowToRecord([null, 'a'], [undefined, ''])).toBeNull();
  });
});
