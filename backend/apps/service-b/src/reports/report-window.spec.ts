import {
  autoBucket,
  capSeries,
  DEFAULT_WINDOW_MS,
  ReportWindowError,
  resolveReportWindow,
  zeroFillBuckets,
} from './report-window';

describe('resolveReportWindow', () => {
  const now = 1_800_000_000_000;

  it('defaults to the last hour with an automatic bucket', () => {
    expect(resolveReportWindow({}, now)).toEqual({
      fromMs: now - DEFAULT_WINDOW_MS,
      toMs: now,
      bucketMs: 60_000,
    });
  });

  it('honours explicit values', () => {
    const w = resolveReportWindow({ from: new Date(now - 10_000), to: new Date(now), bucketMs: 1_000 }, now);
    expect(w).toEqual({ fromMs: now - 10_000, toMs: now, bucketMs: 1_000 });
  });

  it('rejects buckets larger than the window and windows over 366 days', () => {
    expect(() =>
      resolveReportWindow({ from: new Date(now - 5_000), to: new Date(now), bucketMs: 10_000 }, now),
    ).toThrow(/larger/);
    expect(() =>
      resolveReportWindow({ from: new Date(now - 400 * 86_400_000), to: new Date(now) }, now),
    ).toThrow(/366/);
  });

  it('rejects inverted windows and too many buckets', () => {
    expect(() => resolveReportWindow({ from: new Date(now), to: new Date(now - 1) }, now)).toThrow(
      ReportWindowError,
    );
    expect(() =>
      resolveReportWindow({ from: new Date(now - 86_400_000), to: new Date(now), bucketMs: 1_000 }, now),
    ).toThrow(/buckets/);
  });

  it('picks nice buckets', () => {
    expect(autoBucket(60_000)).toBe(1_000);
    expect(autoBucket(24 * 3_600_000)).toBe(30 * 60_000);
    expect(autoBucket(10 * 365 * 86_400_000)).toBe(7 * 86_400_000);
  });
});

describe('zeroFillBuckets', () => {
  it('emits one aligned point per bucket and fills gaps with 0', () => {
    const w = { fromMs: 1_000, toMs: 5_000, bucketMs: 1_000 };
    expect(
      zeroFillBuckets(
        [
          { timestampMs: 2_000, value: 3 },
          { timestampMs: 4_500, value: 1 },
        ],
        w,
      ),
    ).toEqual([
      { timestampMs: 1_000, value: 0 },
      { timestampMs: 2_000, value: 3 },
      { timestampMs: 3_000, value: 0 },
      { timestampMs: 4_000, value: 1 },
      { timestampMs: 5_000, value: 0 },
    ]);
  });
});

describe('capSeries', () => {
  const mk = (key: string, v: number) => ({
    key,
    label: key,
    labels: {},
    points: [{ timestampMs: 1, value: v }],
  });

  it('returns input when within the limit', () => {
    const s = [mk('a', 1)];
    expect(capSeries(s, 3)).toBe(s);
  });

  it('keeps the largest series and folds the rest into "Other"', () => {
    const out = capSeries([mk('a', 1), mk('b', 5), mk('c', 2), mk('d', 4)], 3);
    expect(out.map((s) => s.key)).toEqual(['b', 'd', 'other']);
    expect(out[2]).toMatchObject({ label: 'Other (2 series)', points: [{ timestampMs: 1, value: 3 }] });
  });
});
