export const NICE_BUCKETS_MS = [
  1_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  2 * 3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
  7 * 86_400_000,
] as const;

export const DEFAULT_WINDOW_MS = 60 * 60_000;
export const TARGET_BUCKETS = 60;
export const MAX_BUCKETS = 2_000;
export const MIN_BUCKET_MS = 1_000;
export const MAX_WINDOW_MS = 366 * 86_400_000;

export interface ReportWindow {
  fromMs: number;
  toMs: number;
  bucketMs: number;
}

export class ReportWindowError extends Error {}

export function autoBucket(spanMs: number, target = TARGET_BUCKETS): number {
  const raw = Math.ceil(spanMs / target);
  return NICE_BUCKETS_MS.find((b) => b >= raw) ?? NICE_BUCKETS_MS[NICE_BUCKETS_MS.length - 1];
}

export function resolveReportWindow(
  input: { from?: Date; to?: Date; bucketMs?: number },
  now = Date.now(),
): ReportWindow {
  const toMs = input.to?.getTime() ?? now;
  const fromMs = input.from?.getTime() ?? toMs - DEFAULT_WINDOW_MS;
  if (fromMs >= toMs) throw new ReportWindowError('`from` must be before `to`');
  const span = toMs - fromMs;
  if (span > MAX_WINDOW_MS) throw new ReportWindowError('The report window cannot exceed 366 days');
  const bucketMs = input.bucketMs ?? Math.min(autoBucket(span), span);
  if (bucketMs < MIN_BUCKET_MS) throw new ReportWindowError(`bucketMs must be >= ${MIN_BUCKET_MS}`);
  if (bucketMs > span) throw new ReportWindowError('bucketMs cannot be larger than the report window');
  if (span / bucketMs > MAX_BUCKETS) {
    throw new ReportWindowError(
      `Window produces ${Math.ceil(span / bucketMs)} buckets (max ${MAX_BUCKETS}); increase bucketMs`,
    );
  }
  return { fromMs, toMs, bucketMs };
}

export interface Point {
  timestampMs: number;
  value: number;
}

export function zeroFillBuckets(points: readonly Point[], w: ReportWindow): Point[] {
  const byBucket = new Map<number, number>();
  for (const p of points) {
    const bucket = w.fromMs + Math.floor((p.timestampMs - w.fromMs) / w.bucketMs) * w.bucketMs;
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + p.value);
  }
  const out: Point[] = [];
  for (let t = w.fromMs; t <= w.toMs; t += w.bucketMs)
    out.push({ timestampMs: t, value: byBucket.get(t) ?? 0 });
  return out;
}

export interface NamedSeries {
  key: string;
  label: string;
  labels: Record<string, string>;
  points: Point[];
}

export function capSeries(series: NamedSeries[], max: number): NamedSeries[] {
  if (series.length <= max) return series;
  const total = (s: NamedSeries): number => s.points.reduce((acc, p) => acc + p.value, 0);
  const sorted = [...series].sort((a, b) => total(b) - total(a));
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  const sums = new Map<number, number>();
  for (const s of rest)
    for (const p of s.points) sums.set(p.timestampMs, (sums.get(p.timestampMs) ?? 0) + p.value);
  kept.push({
    key: 'other',
    label: `Other (${rest.length} series)`,
    labels: { aggregated: String(rest.length) },
    points: [...sums.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timestampMs, value]) => ({ timestampMs, value })),
  });
  return kept;
}
