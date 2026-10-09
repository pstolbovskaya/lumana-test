import { BadRequestException } from '@nestjs/common';
import { buildKeysetFilter, decodeCursor, encodeCursor, revive, toCursorValue } from './cursor';

describe('cursor encode/decode', () => {
  it('round-trips a cursor', () => {
    const c = { s: 'dateStart', o: 'asc' as const, v: 1877, id: '65f0c0ffee0000000000abcd' };
    const encoded = encodeCursor(c);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded, { s: 'dateStart', o: 'asc' })).toEqual(c);
  });

  it('round-trips Date values through {$date}', () => {
    const d = new Date('2026-01-02T03:04:05.678Z');
    const encoded = encodeCursor({ s: 'timestamp', o: 'desc', v: toCursorValue(d), id: 'x1' });
    const decoded = decodeCursor(encoded, { s: 'timestamp', o: 'desc' });
    expect(revive(decoded.v)).toEqual(d);
  });

  it('keeps null sort values', () => {
    const encoded = encodeCursor({ s: 'dateStart', o: 'asc', v: toCursorValue(undefined), id: 'a' });
    expect(decodeCursor(encoded, { s: 'dateStart', o: 'asc' }).v).toBeNull();
  });

  it.each([
    'not-base64!!',
    Buffer.from('{"s":1}').toString('base64url'),
    Buffer.from('[]').toString('base64url'),
    '',
  ])('rejects malformed cursor %p', (raw) => {
    expect(() => decodeCursor(raw, { s: '_id', o: 'asc' })).toThrow(BadRequestException);
  });

  it('rejects a cursor issued for a different sort', () => {
    const encoded = encodeCursor({ s: 'title', o: 'asc', v: 'a', id: '1' });
    expect(() => decodeCursor(encoded, { s: 'title', o: 'desc' })).toThrow(/sort/);
    expect(() => decodeCursor(encoded, { s: 'dateStart', o: 'asc' })).toThrow(/sort/);
  });
});

describe('buildKeysetFilter', () => {
  it('uses _id only when sorting by _id', () => {
    expect(buildKeysetFilter('_id', 'asc', undefined, 5)).toEqual({ _id: { $gt: 5 } });
    expect(buildKeysetFilter('_id', 'desc', undefined, 5)).toEqual({ _id: { $lt: 5 } });
  });

  it('asc with a value: greater value, or same value and greater id', () => {
    expect(buildKeysetFilter('f', 'asc', 10, 7)).toEqual({
      $or: [{ f: { $gt: 10 } }, { f: 10, _id: { $gt: 7 } }],
    });
  });

  it('asc within the null block continues into non-null values', () => {
    expect(buildKeysetFilter('f', 'asc', null, 7)).toEqual({
      $or: [{ f: null, _id: { $gt: 7 } }, { f: { $ne: null } }],
    });
  });

  it('desc with a value also includes nulls (sorted last)', () => {
    expect(buildKeysetFilter('f', 'desc', 10, 7)).toEqual({
      $or: [{ f: { $lt: 10 } }, { f: 10, _id: { $lt: 7 } }, { f: null }],
    });
  });

  it('desc within the null block only continues nulls', () => {
    expect(buildKeysetFilter('f', 'desc', null, 7)).toEqual({ f: null, _id: { $lt: 7 } });
  });

  it.each(['asc', 'desc'] as const)('paginates a dataset with nulls exhaustively (%s)', (order) => {
    type Doc = { _id: number; f: number | null };
    const docs: Doc[] = Array.from({ length: 37 }, (_, i) => ({ _id: i, f: i % 5 === 0 ? null : i % 4 }));
    const cmp = (a: Doc, b: Doc): number => {
      const av = a.f === null ? -Infinity : a.f;
      const bv = b.f === null ? -Infinity : b.f;
      const r = av === bv ? a._id - b._id : av - bv;
      return order === 'asc' ? r : -r;
    };
    const matches = (doc: Doc, filter: Record<string, unknown>): boolean => {
      if ('$or' in filter) return (filter.$or as Record<string, unknown>[]).some((f) => matches(doc, f));
      return Object.entries(filter).every(([k, cond]) => {
        const v = doc[k as keyof Doc];
        if (cond === null) return v === null;
        if (typeof cond !== 'object') return v === cond;
        const c = cond as Record<string, number | null>;
        if ('$ne' in c) return v !== c.$ne;
        if (v === null) return false;
        if ('$gt' in c) return v > (c.$gt as number);
        if ('$lt' in c) return v < (c.$lt as number);
        return false;
      });
    };
    const sorted = [...docs].sort(cmp);
    const seen: number[] = [];
    let last: Doc | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const candidates = last
        ? sorted.filter((d) => matches(d, buildKeysetFilter('f', order, last!.f, last!._id)))
        : sorted;
      const page = candidates.slice(0, 4);
      if (page.length === 0) break;
      seen.push(...page.map((d) => d._id));
      last = page[page.length - 1];
    }
    expect(seen).toEqual(sorted.map((d) => d._id));
  });
});
