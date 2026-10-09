import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeGame } from '../games/game.normalizer';
import type { GameData } from '../games/game.types';
import { GamesRepository } from '../games/games.repository';
import { DatasetFormat, DatasetParseError, parseDatasetFile, SourceRecord } from './parsers';

export const MAX_REPORTED_ERRORS = 100;

export interface IngestRowError {
  row: number;
  appid?: number;
  errors: string[];
}

export interface IngestSummary {
  status: 'completed' | 'failed';
  source: string;
  format: DatasetFormat;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failedWrites: number;
  batches: number;
  errors: IngestRowError[];
  errorsTruncated: boolean;
  failureReason?: string;
  durationMs: number;
}

export class ErrorCollector {
  readonly items: IngestRowError[] = [];
  truncated = false;
  constructor(private readonly limit = MAX_REPORTED_ERRORS) {}
  add(e: IngestRowError): void {
    if (this.items.length < this.limit) this.items.push(e);
    else this.truncated = true;
  }
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly batchSize: number;

  constructor(
    private readonly repo: GamesRepository,
    config: ConfigService,
  ) {
    this.batchSize = config.getOrThrow<number>('INGEST_BATCH_SIZE');
  }

  ingestFile(path: string, format: DatasetFormat, source: string): Promise<IngestSummary> {
    return this.ingest(parseDatasetFile(path, format), format, source);
  }

  async ingest(
    records: AsyncIterable<SourceRecord>,
    format: DatasetFormat,
    source: string,
  ): Promise<IngestSummary> {
    const started = Date.now();
    const errors = new ErrorCollector();
    const summary: IngestSummary = {
      status: 'completed',
      source,
      format,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      failedWrites: 0,
      batches: 0,
      errors: errors.items,
      errorsTruncated: false,
      durationMs: 0,
    };

    let batch = new Map<number, { row: number; doc: GameData }>();

    const flush = async (): Promise<void> => {
      if (batch.size === 0) return;
      const entries = [...batch.values()];
      batch = new Map();
      const result = await this.repo.bulkUpsert(
        entries.map((e) => e.doc),
        source,
      );
      summary.batches++;
      summary.inserted += result.upserted;
      summary.updated += result.modified;
      summary.unchanged += result.matched - result.modified;
      summary.failedWrites += result.writeErrors.length;
      for (const w of result.writeErrors) {
        errors.add({ row: entries[w.index]?.row ?? -1, appid: w.appid, errors: [w.message] });
      }
    };

    try {
      for await (const { row, record } of records) {
        summary.totalRows++;
        const result = normalizeGame(record);
        if (!result.ok) {
          summary.invalidRows++;
          const id = Number((record as { appid?: unknown } | null)?.appid);
          errors.add({
            row,
            appid: Number.isSafeInteger(id) && id > 0 ? id : undefined,
            errors: result.errors,
          });
          continue;
        }
        summary.validRows++;
        if (batch.has(result.value.appid)) summary.duplicateRows++;
        batch.set(result.value.appid, { row, doc: result.value });
        if (batch.size >= this.batchSize) await flush();
      }
      await flush();
    } catch (err) {
      summary.status = 'failed';
      summary.failureReason =
        err instanceof DatasetParseError
          ? err.message
          : `Ingest aborted: ${err instanceof Error ? err.message : String(err)}`;
      if (!(err instanceof DatasetParseError)) this.logger.error(summary.failureReason);
      await flush().catch(() => undefined);
    }

    summary.errorsTruncated = errors.truncated;
    summary.durationMs = Date.now() - started;
    this.logger.log(
      `Ingest ${source}: ${summary.status}, rows=${summary.totalRows} valid=${summary.validRows} ` +
        `invalid=${summary.invalidRows} inserted=${summary.inserted} updated=${summary.updated} (${summary.durationMs}ms)`,
    );
    return summary;
  }
}
