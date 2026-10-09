import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Collection, Filter, Sort } from 'mongodb';
import type { Db } from 'mongodb';
import {
  ApiEvent,
  buildKeysetFilter,
  CursorPage,
  decodeCursor,
  encodeCursor,
  InjectDb,
  revive,
  toCursorValue,
} from '@app/common';
import type { SortOrder } from '@app/common';
import { EventLogDocument, LOGS_COLLECTION } from './log.types';

export interface LogFilter {
  from?: Date;
  to?: Date;
  type?: string;
  service?: string;
  action?: string;
  method?: string;
  statusCode?: number;
}

export interface LogQuery extends LogFilter {
  order: SortOrder;
  limit: number;
  cursor?: string;
}

export interface ActionStats {
  action: string;
  count: number;
  errors: number;
  avgDurationMs: number;
  p95DurationMs: number | null;
  maxDurationMs: number;
}

export interface LogStats {
  total: number;
  errors: number;
  avgDurationMs: number | null;
  byAction: ActionStats[];
  byStatusCode: Array<{ statusCode: number; count: number }>;
  byService: Array<{ service: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
}

const TIMESTAMP = 'timestamp';

export function buildLogFilter(f: LogFilter): Filter<EventLogDocument> {
  const filter: Filter<EventLogDocument> = {};
  if (f.type) filter.type = f.type as EventLogDocument['type'];
  if (f.service) filter.service = f.service;
  if (f.action) filter.action = f.action;
  if (f.method) filter.method = f.method.toUpperCase();
  if (f.statusCode !== undefined) filter.statusCode = f.statusCode;
  if (f.from || f.to) {
    filter.timestamp = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  }
  return filter;
}

@Injectable()
export class LogsRepository implements OnModuleInit {
  private readonly logger = new Logger(LogsRepository.name);
  private readonly collection: Collection<EventLogDocument>;

  constructor(@InjectDb() db: Db) {
    this.collection = db.collection<EventLogDocument>(LOGS_COLLECTION);
  }

  async onModuleInit(): Promise<void> {
    await this.collection.createIndexes([
      { key: { timestamp: -1, _id: -1 }, name: 'timestamp_id' },
      { key: { type: 1, timestamp: -1, _id: -1 }, name: 'type_timestamp_id' },
      { key: { service: 1, timestamp: -1, _id: -1 }, name: 'service_timestamp_id' },
      { key: { action: 1, timestamp: -1, _id: -1 }, name: 'action_timestamp_id' },
      { key: { statusCode: 1, timestamp: -1, _id: -1 }, name: 'status_timestamp_id' },
    ]);
    this.logger.log('Event log indexes ensured');
  }

  async insertEvent(event: ApiEvent): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: event.id },
      {
        $setOnInsert: {
          type: event.type,
          service: event.service,
          action: event.action,
          method: event.method,
          path: event.path,
          statusCode: event.statusCode,
          durationMs: event.durationMs,
          timestamp: new Date(event.timestamp),
          metadata: event.metadata ?? {},
          receivedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return res.upsertedCount === 1;
  }

  async findById(id: string): Promise<EventLogDocument | null> {
    return this.collection.findOne({ _id: id });
  }

  async find(q: LogQuery): Promise<CursorPage<EventLogDocument>> {
    const base = buildLogFilter(q);
    let filter: Filter<EventLogDocument> = base;
    if (q.cursor) {
      const c = decodeCursor(q.cursor, { s: TIMESTAMP, o: q.order });
      const v = revive(c.v);
      if (!(v instanceof Date)) throw new BadRequestException('Invalid cursor');
      filter = { $and: [base, buildKeysetFilter(TIMESTAMP, q.order, v, c.id)] };
    }
    const dir = q.order === 'asc' ? 1 : -1;
    const sort: Sort = { timestamp: dir, _id: dir };
    const docs = await this.collection
      .find(filter)
      .sort(sort)
      .limit(q.limit + 1)
      .toArray();
    const hasMore = docs.length > q.limit;
    const items = hasMore ? docs.slice(0, q.limit) : docs;
    const last = items[items.length - 1];
    return {
      items,
      limit: q.limit,
      nextCursor:
        hasMore && last
          ? encodeCursor({ s: TIMESTAMP, o: q.order, v: toCursorValue(last.timestamp), id: last._id })
          : null,
    };
  }

  async stats(f: LogFilter): Promise<LogStats> {
    const [res] = await this.collection
      .aggregate<{
        totals: Array<{ total: number; errors: number; avgDurationMs: number }>;
        byAction: ActionStats[];
        byStatusCode: Array<{ statusCode: number; count: number }>;
        byService: Array<{ service: string; count: number }>;
        byType: Array<{ type: string; count: number }>;
      }>([
        { $match: buildLogFilter(f) },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
                  avgDurationMs: { $avg: '$durationMs' },
                },
              },
            ],
            byAction: [
              {
                $group: {
                  _id: '$action',
                  count: { $sum: 1 },
                  errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
                  avgDurationMs: { $avg: '$durationMs' },
                  maxDurationMs: { $max: '$durationMs' },
                  p95: { $percentile: { input: '$durationMs', p: [0.95], method: 'approximate' } },
                },
              },
              { $sort: { count: -1, _id: 1 } },
              {
                $project: {
                  _id: 0,
                  action: '$_id',
                  count: 1,
                  errors: 1,
                  maxDurationMs: 1,
                  avgDurationMs: { $round: ['$avgDurationMs', 2] },
                  p95DurationMs: { $round: [{ $arrayElemAt: ['$p95', 0] }, 2] },
                },
              },
            ],
            byStatusCode: [
              { $group: { _id: '$statusCode', count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              { $project: { _id: 0, statusCode: '$_id', count: 1 } },
            ],
            byService: [
              { $group: { _id: '$service', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $project: { _id: 0, service: '$_id', count: 1 } },
            ],
            byType: [
              { $group: { _id: '$type', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $project: { _id: 0, type: '$_id', count: 1 } },
            ],
          },
        },
      ])
      .toArray();
    const totals = res?.totals[0];
    return {
      total: totals?.total ?? 0,
      errors: totals?.errors ?? 0,
      avgDurationMs: totals ? Math.round(totals.avgDurationMs * 100) / 100 : null,
      byAction: res?.byAction ?? [],
      byStatusCode: res?.byStatusCode ?? [],
      byService: res?.byService ?? [],
      byType: res?.byType ?? [],
    };
  }

  async countByAction(f: LogFilter): Promise<Array<{ type: string; count: number }>> {
    return this.collection
      .aggregate<{ type: string; count: number }>([
        { $match: buildLogFilter(f) },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $project: { _id: 0, type: '$_id', count: 1 } },
      ])
      .toArray();
  }
}
