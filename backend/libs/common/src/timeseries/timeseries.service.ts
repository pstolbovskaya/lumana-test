import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '../redis/redis.module';
import type { RedisClient } from '../redis/redis.module';

export interface TsPoint {
  timestampMs: number;
  value: number;
}

export interface TsSeries {
  key: string;
  labels: Record<string, string>;
  points: TsPoint[];
}

export type TsAggregation = 'SUM' | 'AVG' | 'MAX' | 'MIN' | 'COUNT';

export interface TsAddParams {
  key: string;
  value: number;
  timestampMs?: number;
  labels: Record<string, string>;
  retentionMs: number;
}

export interface TsMRangeParams {
  fromMs: number;
  toMs: number;
  filters: string[];
  bucketMs: number;
  aggregation?: TsAggregation;
}

type RawLabels = Map<unknown, unknown> | Record<string, unknown> | Array<[unknown, unknown]>;

function toPlainRecord(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  const entries: Iterable<[unknown, unknown]> =
    input instanceof Map
      ? input.entries()
      : Array.isArray(input)
        ? (input as Array<[unknown, unknown]>)
        : Object.entries(input as Record<string, unknown>);
  for (const [k, v] of entries) out[String(k)] = String(v);
  return out;
}

export function normalizeMRangeReply(reply: unknown): TsSeries[] {
  const entries: Array<[unknown, unknown]> =
    reply instanceof Map ? [...reply.entries()] : Object.entries((reply ?? {}) as Record<string, unknown>);

  return entries.map(([key, value]) => {
    const v = value as { labels?: RawLabels; samples?: Array<{ timestamp: unknown; value: unknown }> };
    return {
      key: String(key),
      labels: toPlainRecord(v.labels),
      points: (v.samples ?? []).map((s) => ({
        timestampMs: Number(s.timestamp),
        value: Number(s.value),
      })),
    };
  });
}

@Injectable()
export class TimeSeriesService {
  private readonly logger = new Logger(TimeSeriesService.name);

  constructor(@InjectRedis() private readonly redis: RedisClient) {}

  async add(params: TsAddParams): Promise<void> {
    await this.redis.ts.add(params.key, params.timestampMs ?? Date.now(), params.value, {
      RETENTION: params.retentionMs,
      ON_DUPLICATE: 'SUM',
      LABELS: params.labels,
    });
  }

  async mrange(params: TsMRangeParams): Promise<TsSeries[]> {
    const reply = await this.redis.ts.mRangeWithLabels(params.fromMs, params.toMs, params.filters, {
      ALIGN: params.fromMs,
      AGGREGATION: {
        type: params.aggregation ?? 'SUM',
        timeBucket: params.bucketMs,
        EMPTY: false,
      },
    });
    const series = normalizeMRangeReply(reply);
    this.logger.debug(`TS.MRANGE returned ${series.length} series`);
    return series.sort((a, b) => a.key.localeCompare(b.key));
  }
}
