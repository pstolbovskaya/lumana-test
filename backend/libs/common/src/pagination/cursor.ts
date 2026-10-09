import { BadRequestException } from '@nestjs/common';

export type SortOrder = 'asc' | 'desc';
export type CursorValue = string | number | boolean | null;

export interface KeysetCursor {
  s: string;
  o: SortOrder;
  v?: CursorValue | { $date: string };
  id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isCursorValue(v: unknown): boolean {
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return true;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { $date?: unknown }).$date === 'string' &&
    !Number.isNaN(Date.parse((v as { $date: string }).$date))
  );
}

export function decodeCursor(raw: string, expected: { s: string; o: SortOrder }): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const c = parsed as Partial<KeysetCursor> | null;
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.s !== 'string' ||
    (c.o !== 'asc' && c.o !== 'desc') ||
    typeof c.id !== 'string' ||
    c.id.length === 0 ||
    ('v' in c && !isCursorValue(c.v))
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  if (c.s !== expected.s || c.o !== expected.o) {
    throw new BadRequestException(
      `Cursor was issued for sort "${c.s}:${c.o}" but the request uses "${expected.s}:${expected.o}"`,
    );
  }
  return c as KeysetCursor;
}

export function revive(value: KeysetCursor['v']): CursorValue | Date | undefined {
  if (value && typeof value === 'object' && '$date' in value) return new Date(value.$date);
  return value;
}

export function toCursorValue(value: unknown): KeysetCursor['v'] {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value === undefined) return null;
  return value as CursorValue;
}

export function buildKeysetFilter<TId>(
  field: string,
  order: SortOrder,
  lastValue: CursorValue | Date | undefined,
  lastId: TId,
): Record<string, unknown> {
  if (field === '_id') {
    return { _id: { [order === 'asc' ? '$gt' : '$lt']: lastId } };
  }
  const v = lastValue ?? null;
  if (order === 'asc') {
    if (v === null) {
      return { $or: [{ [field]: null, _id: { $gt: lastId } }, { [field]: { $ne: null } }] };
    }
    return { $or: [{ [field]: { $gt: v } }, { [field]: v, _id: { $gt: lastId } }] };
  }
  if (v === null) {
    return { [field]: null, _id: { $lt: lastId } };
  }
  return {
    $or: [{ [field]: { $lt: v } }, { [field]: v, _id: { $lt: lastId } }, { [field]: null }],
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}
