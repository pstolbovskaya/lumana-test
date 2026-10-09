export const TS_KEY_PREFIX = 'events';

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'other';

export function statusClassOf(statusCode: number): StatusClass {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
}

export function sanitizeSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'unknown';
}

export interface TsKeyParts {
  service: string;
  action: string;
  status: StatusClass;
}

export function buildTsKey(parts: TsKeyParts): string {
  return [TS_KEY_PREFIX, sanitizeSegment(parts.service), sanitizeSegment(parts.action), parts.status].join(
    ':',
  );
}

export function buildTsLabels(parts: TsKeyParts): Record<string, string> {
  return {
    metric: 'requests',
    service: sanitizeSegment(parts.service),
    action: sanitizeSegment(parts.action),
    status: parts.status,
  };
}

export function humanizeSeriesLabel(labels: Record<string, string>, fallback: string): string {
  if (labels.action) {
    return labels.status ? `${labels.action} (${labels.status})` : labels.action;
  }
  return fallback;
}
