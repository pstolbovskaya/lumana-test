import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnyBulkWriteOperation, Collection, Filter, MongoBulkWriteError, ObjectId, Sort } from 'mongodb';
import type { Db, IndexDescription, WriteError } from 'mongodb';
import { createHash } from 'node:crypto';
import {
  buildKeysetFilter,
  CursorPage,
  decodeCursor,
  encodeCursor,
  InjectDb,
  revive,
  SortOrder,
  toCursorValue,
} from '@app/common';
import { GAMES_COLLECTION, GameData, GameDocument } from './game.types';

export const GAME_SORT_FIELDS = [
  '_id',
  'appid',
  'name',
  'ccu',
  'positive',
  'reviewScore',
  'priceCents',
] as const;
export type GameSortField = (typeof GAME_SORT_FIELDS)[number];

export const DEFAULT_SORT_ORDER: Record<GameSortField, SortOrder> = {
  _id: 'asc',
  appid: 'asc',
  name: 'asc',
  ccu: 'desc',
  positive: 'desc',
  reviewScore: 'desc',
  priceCents: 'asc',
};

export const EQUALITY_FILTER_KEYS = ['developerKey', 'publisherKey'] as const;

export interface GameFilterCriteria {
  q?: string;
  developer?: string;
  publisher?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  minReviewScore?: number;
  freeOnly?: boolean;
  minOwners?: number;
}

export interface GameSearchCriteria extends GameFilterCriteria {
  sortBy: GameSortField;
  order?: SortOrder;
  limit: number;
  cursor?: string;
}

export interface BulkUpsertResult {
  upserted: number;
  modified: number;
  matched: number;
  writeErrors: Array<{ index: number; appid?: number; message: string }>;
}

export function contentHash(doc: GameData): string {
  return createHash('sha1').update(JSON.stringify(doc)).digest('base64url');
}

export function buildSort(sortBy: GameSortField, order: SortOrder): Sort {
  const dir = order === 'asc' ? 1 : -1;
  return sortBy === '_id' ? { _id: dir } : { [sortBy]: dir, _id: dir };
}

export function gameIndexes(): IndexDescription[] {
  const indexes: IndexDescription[] = [
    { key: { appid: 1 }, name: 'uniq_appid', unique: true },
    {
      key: { name: 'text', developer: 'text', publisher: 'text' },
      name: 'text_search',
      weights: { name: 10, developer: 4, publisher: 2 },
      default_language: 'english',
    },
  ];
  for (const field of GAME_SORT_FIELDS) {
    if (field !== '_id') indexes.push({ key: { [field]: 1, _id: 1 }, name: `${field}_id` });
    for (const eq of EQUALITY_FILTER_KEYS) {
      indexes.push({
        key: field === '_id' ? { [eq]: 1, _id: 1 } : { [eq]: 1, [field]: 1, _id: 1 },
        name: field === '_id' ? `${eq}_id` : `${eq}_${field}_id`,
      });
    }
  }
  return indexes;
}

const UNIQUE_SORT_FIELDS: ReadonlySet<GameSortField> = new Set(['appid']);

export function buildGameKeysetFilter(
  sortBy: GameSortField,
  order: SortOrder,
  lastValue: ReturnType<typeof revive>,
  lastId: ObjectId,
): Filter<GameDocument> {
  if (UNIQUE_SORT_FIELDS.has(sortBy) && typeof lastValue === 'number') {
    return { [sortBy]: { [order === 'asc' ? '$gt' : '$lt']: lastValue } };
  }
  return buildKeysetFilter(sortBy, order, lastValue, lastId);
}

export function sortIndexHint(
  c: Pick<GameSearchCriteria, 'q' | 'developer' | 'publisher' | 'sortBy'>,
): string | undefined {
  if (c.q) return undefined;
  const eq = c.developer ? 'developerKey' : c.publisher ? 'publisherKey' : undefined;
  if (eq) return c.sortBy === '_id' ? `${eq}_id` : `${eq}_${c.sortBy}_id`;
  return c.sortBy === '_id' ? '_id_' : `${c.sortBy}_id`;
}

export function buildGameFilter(c: GameFilterCriteria): Filter<GameDocument> {
  const filter: Filter<GameDocument> = {};
  if (c.q) filter.$text = { $search: c.q };
  if (c.developer) filter.developerKey = c.developer.trim().toLowerCase();
  if (c.publisher) filter.publisherKey = c.publisher.trim().toLowerCase();
  if (c.freeOnly) {
    filter.priceCents = 0;
  } else if (c.minPriceCents !== undefined || c.maxPriceCents !== undefined) {
    filter.priceCents = {
      ...(c.minPriceCents !== undefined ? { $gte: c.minPriceCents } : {}),
      ...(c.maxPriceCents !== undefined ? { $lte: c.maxPriceCents } : {}),
    };
  }
  if (c.minReviewScore !== undefined) filter.reviewScore = { $gte: c.minReviewScore };
  if (c.minOwners !== undefined) filter.ownersMin = { $gte: c.minOwners };
  return filter;
}

@Injectable()
export class GamesRepository implements OnModuleInit {
  private readonly logger = new Logger(GamesRepository.name);
  private readonly collection: Collection<GameDocument>;

  constructor(@InjectDb() db: Db) {
    this.collection = db.collection<GameDocument>(GAMES_COLLECTION);
  }

  async onModuleInit(): Promise<void> {
    const indexes = gameIndexes();
    await this.collection.createIndexes(indexes);
    this.logger.log(`Game indexes ensured (${indexes.length})`);
  }

  async bulkUpsert(docs: GameData[], source: string): Promise<BulkUpsertResult> {
    if (docs.length === 0) return { upserted: 0, modified: 0, matched: 0, writeErrors: [] };
    const now = new Date();
    const ops: AnyBulkWriteOperation<GameDocument>[] = docs.map((doc) => {
      const hash = contentHash(doc);
      const unchanged = { $eq: ['$contentHash', hash] };
      const fields: Record<string, { $literal: unknown }> = {};
      for (const [k, v] of Object.entries(doc)) fields[k] = { $literal: v as unknown };
      return {
        updateOne: {
          filter: { appid: doc.appid },
          update: [
            {
              $set: {
                ...fields,
                contentHash: hash,
                source: { $cond: [unchanged, '$source', { $literal: source }] },
                createdAt: { $ifNull: ['$createdAt', now] },
                updatedAt: { $cond: [unchanged, '$updatedAt', now] },
              },
            },
          ],
          upsert: true,
        },
      };
    });
    try {
      const res = await this.collection.bulkWrite(ops, { ordered: false });
      return {
        upserted: res.upsertedCount,
        modified: res.modifiedCount,
        matched: res.matchedCount,
        writeErrors: [],
      };
    } catch (err) {
      if (err instanceof MongoBulkWriteError) {
        const raw = err.writeErrors as WriteError | WriteError[];
        const errors: WriteError[] = Array.isArray(raw) ? raw : [raw];
        return {
          upserted: err.result.upsertedCount,
          modified: err.result.modifiedCount,
          matched: err.result.matchedCount,
          writeErrors: errors.map((e) => ({
            index: e.index,
            appid: docs[e.index]?.appid,
            message: e.errmsg ?? 'write error',
          })),
        };
      }
      throw err;
    }
  }

  async findByAppid(appid: number): Promise<GameDocument | null> {
    return this.collection.findOne({ appid });
  }

  async count(): Promise<number> {
    return this.collection.estimatedDocumentCount();
  }

  async search(c: GameSearchCriteria): Promise<CursorPage<GameDocument>> {
    const order = c.order ?? DEFAULT_SORT_ORDER[c.sortBy];
    const base = buildGameFilter(c);
    const and: Filter<GameDocument>[] = [base];

    if (c.cursor) {
      const cursor = decodeCursor(c.cursor, { s: c.sortBy, o: order });
      if (!ObjectId.isValid(cursor.id)) throw new BadRequestException('Invalid cursor');
      and.push(buildGameKeysetFilter(c.sortBy, order, revive(cursor.v), new ObjectId(cursor.id)));
    }
    const filter = and.length === 1 ? base : { $and: and };

    const find = this.collection
      .find(filter)
      .sort(buildSort(c.sortBy, order))
      .limit(c.limit + 1);
    const hint = sortIndexHint(c);
    if (hint) find.hint(hint);
    const docs = await find.toArray();

    const hasMore = docs.length > c.limit;
    const items = hasMore ? docs.slice(0, c.limit) : docs;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            s: c.sortBy,
            o: order,
            id: last._id.toHexString(),
            ...(c.sortBy === '_id' ? {} : { v: toCursorValue(last[c.sortBy]) }),
          })
        : null;
    return { items, nextCursor, limit: c.limit };
  }
}
