import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawGame } from '../games/game.types';
import type { DatasetStorage } from './dataset-storage';
import { FetchJobsRegistry } from './fetch-jobs.registry';
import { FetchService, MAX_CONSECUTIVE_PAGE_FAILURES } from './fetch.service';
import { parseDatasetFile } from './parsers';
import { RateLimiter } from './rate-limiter';
import type { FetchPageOptions, SteamSpyClient, SteamSpyPage } from './steamspy.client';

const game = (appid: number): RawGame => ({ appid, name: `G${appid}`, owners: '0 .. 20,000', price: '0' });

class FakeClient {
  readonly limiter = new RateLimiter(0);
  readonly requested: number[] = [];
  gate?: Promise<void>;
  constructor(private readonly pages: Record<number, RawGame[] | Error>) {}
  async fetchPage(page: number, opts: FetchPageOptions = {}): Promise<SteamSpyPage> {
    this.requested.push(page);
    if (this.gate) await this.gate;
    opts.signal?.throwIfAborted();
    const p = this.pages[page] ?? [];
    if (p instanceof Error) throw p;
    return { page, games: p };
  }
}

describe('FetchService', () => {
  let dir: string;
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fetch-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const make = (client: FakeClient) => {
    const registry = new FetchJobsRegistry();
    const config = { getOrThrow: () => 100 } as unknown as ConfigService;
    const service = new FetchService(
      client as unknown as SteamSpyClient,
      { exportsDir: dir } as DatasetStorage,
      registry,
      config,
    );
    return { service, registry };
  };

  it('fetches pages sequentially, stops at the first empty page and writes JSON + XLSX', async () => {
    const client = new FakeClient({ 0: [game(1), game(2)], 1: [game(3)], 2: [] });
    const { service } = make(client);
    const { job, done } = service.start({ pages: 10, format: 'both', baseName: 'g' });
    const finished = await done;
    expect(client.requested).toEqual([0, 1, 2]);
    expect(finished.status).toBe('completed');
    expect(job.progress).toMatchObject({
      pagesDone: 2,
      records: 3,
      endOfCatalog: true,
      currentPage: null,
      nextRequestAt: null,
    });
    expect(finished.result?.files.map((f) => f.name).sort()).toEqual(['g.json', 'g.xlsx']);
    const rows = JSON.parse(await readFile(join(dir, 'g.json'), 'utf8')) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.appid)).toEqual([1, 2, 3]);
    expect(Object.keys(rows[0])[0]).toBe('appid');
    const xlsx: unknown[] = [];
    for await (const r of parseDatasetFile(join(dir, 'g.xlsx'), 'xlsx')) xlsx.push(r.record);
    expect(xlsx).toHaveLength(3);
    expect(await readdir(dir)).not.toContainEqual(expect.stringMatching(/\.part$/));
  });

  it('honours startPage and records failed pages without failing the job', async () => {
    const client = new FakeClient({ 5: [game(1)], 6: new Error('HTTP 503'), 7: [game(2)] });
    const { service } = make(client);
    const finished = await service.start({ pages: 3, startPage: 5, format: 'json', baseName: 'g' }).done;
    expect(client.requested).toEqual([5, 6, 7]);
    expect(finished.status).toBe('completed');
    expect(finished.result).toMatchObject({ records: 2, failedPages: [{ page: 6, error: 'HTTP 503' }] });
  });

  it(`stops after ${MAX_CONSECUTIVE_PAGE_FAILURES} consecutive failures; fails if nothing was fetched`, async () => {
    const err = new Error('down');
    const client = new FakeClient({ 0: err, 1: err, 2: err, 3: [game(1)] });
    const { service } = make(client);
    const finished = await service.start({ pages: 10, format: 'json', baseName: 'g' }).done;
    expect(client.requested).toEqual([0, 1, 2]);
    expect(finished.status).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects a second running job for the same file name with 409, allows other names', async () => {
    const client = new FakeClient({ 0: [game(1)] });
    let open!: () => void;
    client.gate = new Promise((r) => (open = r));
    const { service } = make(client);
    const first = service.start({ pages: 1, format: 'json', baseName: 'same' });
    expect(() => service.start({ pages: 1, format: 'json', baseName: 'same' })).toThrow(ConflictException);
    const other = service.start({ pages: 1, format: 'json', baseName: 'other' });
    open();
    await Promise.all([first.done, other.done]);
    const again = service.start({ pages: 1, format: 'json', baseName: 'same' });
    expect((await again.done).status).toBe('completed');
  });

  it('cancels a running job and discards partial files', async () => {
    const client = new FakeClient({ 0: [game(1)], 1: [game(2)] });
    const { service, registry } = make(client);
    let open!: () => void;
    const { job, done } = service.start({ pages: 2, format: 'both', baseName: 'c' });
    client.gate = new Promise((r) => (open = r));
    await new Promise((r) => setImmediate(r));
    registry.cancel(job.id);
    open();
    const finished = await done;
    expect(finished.status).toBe('cancelled');
    expect(() => registry.cancel(job.id)).toThrow(ConflictException);
    expect(await readdir(dir)).toEqual([]);
  });
});
