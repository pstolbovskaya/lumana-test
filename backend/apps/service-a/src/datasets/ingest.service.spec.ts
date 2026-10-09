import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GameData } from '../games/game.types';
import type { GamesRepository, BulkUpsertResult } from '../games/games.repository';
import { IngestService, MAX_REPORTED_ERRORS } from './ingest.service';
import { DatasetParseError, SourceRecord } from './parsers';

class FakeRepo {
  batches: GameData[][] = [];
  failIds = new Set<number>();
  bulkUpsert(docs: GameData[]): Promise<BulkUpsertResult> {
    this.batches.push(docs);
    const writeErrors = docs
      .map((d, index) => ({ d, index }))
      .filter(({ d }) => this.failIds.has(d.appid))
      .map(({ d, index }) => ({ index, appid: d.appid, message: 'boom' }));
    return Promise.resolve({
      upserted: docs.length - writeErrors.length,
      modified: 0,
      matched: 0,
      writeErrors,
    });
  }
}

async function* source(records: unknown[], failAfter?: number): AsyncGenerator<SourceRecord> {
  let i = 0;
  for (const record of records) {
    await Promise.resolve();
    if (failAfter !== undefined && i === failAfter) throw new DatasetParseError('Malformed JSON: boom');
    yield { row: ++i, record };
  }
}

function makeService(repo: FakeRepo, batchSize = 3): IngestService {
  const config = { getOrThrow: () => batchSize } as unknown as ConfigService;
  return new IngestService(repo as unknown as GamesRepository, config);
}

const rec = (appid: number, name = `T${appid}`) => ({ appid, name, owners: '0 .. 20,000' });

describe('IngestService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('batches valid rows and summarises', async () => {
    const repo = new FakeRepo();
    const s = await makeService(repo).ingest(
      source([rec(1), rec(2), rec(3), rec(4), { appid: 'x' }]),
      'json',
      't',
    );
    expect(repo.batches.map((b) => b.map((d) => d.appid))).toEqual([[1, 2, 3], [4]]);
    expect(s).toMatchObject({
      status: 'completed',
      totalRows: 5,
      validRows: 4,
      invalidRows: 1,
      inserted: 4,
      batches: 2,
    });
    expect(s.errors[0]).toMatchObject({ row: 5 });
  });

  it('dedupes by natural id within a batch (last wins)', async () => {
    const repo = new FakeRepo();
    const s = await makeService(repo, 10).ingest(source([rec(1, 'old'), rec(2), rec(1, 'new')]), 'json', 't');
    expect(repo.batches[0].map((d) => [d.appid, d.name])).toEqual([
      [1, 'new'],
      [2, 'T2'],
    ]);
    expect(s.duplicateRows).toBe(1);
  });

  it('reports write errors with row numbers', async () => {
    const repo = new FakeRepo();
    repo.failIds.add(2);
    const s = await makeService(repo).ingest(source([rec(1), rec(2)]), 'json', 't');
    expect(s.failedWrites).toBe(1);
    expect(s.errors).toEqual([{ row: 2, appid: 2, errors: ['boom'] }]);
  });

  it('caps reported errors but counts all invalid rows', async () => {
    const rows = Array.from({ length: MAX_REPORTED_ERRORS + 5 }, () => ({ appid: 0 }));
    const s = await makeService(new FakeRepo()).ingest(source(rows), 'json', 't');
    expect(s.invalidRows).toBe(MAX_REPORTED_ERRORS + 5);
    expect(s.errors).toHaveLength(MAX_REPORTED_ERRORS);
    expect(s.errorsTruncated).toBe(true);
  });

  it('marks the run failed on parse errors but keeps rows parsed so far', async () => {
    const repo = new FakeRepo();
    const s = await makeService(repo, 10).ingest(source([rec(1), rec(2), rec(3)], 2), 'json', 't');
    expect(s.status).toBe('failed');
    expect(s.failureReason).toMatch(/Malformed/);
    expect(s.inserted).toBe(2);
  });
});
