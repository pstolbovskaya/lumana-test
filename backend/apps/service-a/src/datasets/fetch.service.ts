import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RawGame, STEAMSPY_FIELDS } from '../games/game.types';
import { DatasetStorage } from './dataset-storage';
import { FetchJob, FetchJobsRegistry, FetchResult, JobCancelledError } from './fetch-jobs.registry';
import { SteamSpyClient } from './steamspy.client';
import { DatasetWriter, JsonArrayWriter, XlsxWriter } from './writers/dataset-writer';

export type ExportFormat = 'json' | 'xlsx' | 'both';

export interface FetchOptions {
  pages: number;
  startPage?: number;
  format: ExportFormat;
  baseName?: string;
}

export const MAX_CONSECUTIVE_PAGE_FAILURES = 3;

function project(raw: RawGame): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of STEAMSPY_FIELDS) out[f] = raw[f] ?? null;
  return out;
}

const iso = (ms: number): string => new Date(ms).toISOString();

@Injectable()
export class FetchService {
  private readonly logger = new Logger(FetchService.name);
  private readonly maxPages: number;

  constructor(
    private readonly client: SteamSpyClient,
    private readonly storage: DatasetStorage,
    private readonly jobs: FetchJobsRegistry,
    config: ConfigService,
  ) {
    this.maxPages = config.getOrThrow<number>('FETCH_MAX_PAGES');
  }

  start(options: FetchOptions): { job: FetchJob; done: Promise<FetchJob> } {
    const pages = Math.min(options.pages, this.maxPages);
    const startPage = options.startPage ?? 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = options.baseName ?? `games-${stamp}`;
    const { job, signal } = this.jobs.create({
      fileName,
      pagesTotal: pages,
      startPage,
      rateLimitMs: this.client.limiter.intervalMs,
    });
    const done = this.run(job, { ...options, pages, startPage }, signal)
      .then(
        (result) => {
          job.status = 'completed';
          job.result = result;
          return job;
        },
        (err: unknown) => {
          job.error = err instanceof Error ? err.message : String(err);
          if (err instanceof JobCancelledError) {
            job.status = 'cancelled';
            this.logger.warn(`Fetch job ${job.id} cancelled after ${job.progress.pagesDone} pages`);
          } else {
            job.status = 'failed';
            this.logger.error(`Fetch job ${job.id} failed: ${job.error}`);
          }
          return job;
        },
      )
      .finally(() => {
        job.finishedAt = new Date();
        job.progress.currentPage = null;
        job.progress.nextRequestAt = null;
        job.progress.estimatedCompletionAt = null;
        this.jobs.release(job.id);
      });
    return { job, done };
  }

  private refreshTiming(job: FetchJob, remaining: number): void {
    const now = Date.now();
    const next = Math.max(now, this.client.limiter.nextRequestAt);
    job.progress.nextRequestAt = next > now ? iso(next) : null;
    job.progress.estimatedCompletionAt =
      remaining > 0 ? iso(next + (remaining - 1) * this.client.limiter.intervalMs) : null;
  }

  private async run(
    job: FetchJob,
    options: Required<Pick<FetchOptions, 'pages' | 'startPage' | 'format'>>,
    signal: AbortSignal,
  ): Promise<FetchResult> {
    const started = Date.now();
    const writers: DatasetWriter[] = [];
    if (options.format === 'json' || options.format === 'both') {
      writers.push(new JsonArrayWriter(join(this.storage.exportsDir, `${job.fileName}.json`)));
    }
    if (options.format === 'xlsx' || options.format === 'both') {
      writers.push(
        new XlsxWriter(join(this.storage.exportsDir, `${job.fileName}.xlsx`), STEAMSPY_FIELDS, 'games'),
      );
    }

    const p = job.progress;
    const failedPages: FetchResult['failedPages'] = [];
    let consecutiveFailures = 0;

    try {
      for (let i = 0; i < options.pages; i++) {
        const page = options.startPage + i;
        p.currentPage = page;
        this.refreshTiming(job, options.pages - i);

        let games: RawGame[];
        try {
          ({ games } = await this.client.fetchPage(page, {
            signal,
            onRetry: (info) => {
              p.retries++;
              p.lastError = `page ${info.page}: ${info.error}`;
              this.refreshTiming(job, options.pages - i);
            },
          }));
        } catch (err) {
          if (signal.aborted) throw signal.reason;
          const message = err instanceof Error ? err.message : String(err);
          p.pagesFailed++;
          p.lastError = `page ${page}: ${message}`;
          failedPages.push({ page, error: message });
          if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) {
            this.logger.warn(`Fetch job ${job.id}: ${consecutiveFailures} pages failed in a row, stopping`);
            break;
          }
          continue;
        }
        consecutiveFailures = 0;

        if (games.length === 0) {
          p.endOfCatalog = true;
          break;
        }
        for (const raw of games) {
          const rec = project(raw);
          for (const w of writers) await w.write(rec);
        }
        p.records += games.length;
        p.pagesDone++;
        this.refreshTiming(job, options.pages - i - 1);
      }

      if (p.pagesDone === 0 && failedPages.length > 0) {
        throw new Error(
          `All requested pages failed; last error: ${failedPages[failedPages.length - 1].error}`,
        );
      }
      for (const w of writers) await w.commit();
    } catch (err) {
      await Promise.all(writers.map((w) => w.abort()));
      throw err;
    }

    const files: FetchResult['files'] = [];
    for (const w of writers) {
      const name = w.finalPath.substring(this.storage.exportsDir.length + 1);
      const s = await stat(w.finalPath);
      files.push({ name, format: name.endsWith('.xlsx') ? 'xlsx' : 'json', sizeBytes: s.size });
    }
    const result: FetchResult = {
      files,
      records: p.records,
      pagesRequested: options.pages,
      pagesFetched: p.pagesDone,
      failedPages,
      endOfCatalog: p.endOfCatalog,
      durationMs: Date.now() - started,
    };
    this.logger.log(
      `Fetch job ${job.id}: ${result.records} games from ${result.pagesFetched} pages ` +
        `(${failedPages.length} failed${p.endOfCatalog ? ', end of catalog' : ''}) in ${result.durationMs}ms ` +
        `-> ${files.map((f) => f.name).join(', ')}`,
    );
    return result;
  }
}
