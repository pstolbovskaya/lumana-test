export const API_EVENT_PATTERN = 'api.event';

export const EVENTS_CLIENT = Symbol('EVENTS_CLIENT');

export type ApiEventType = 'http.request' | 'job.completed' | 'job.failed';

export interface ApiEvent {
  id: string;
  type: ApiEventType;
  service: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isApiEvent(value: unknown): value is ApiEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    isString(e.id) &&
    isString(e.type) &&
    isString(e.service) &&
    isString(e.action) &&
    isString(e.method) &&
    isString(e.path) &&
    isNumber(e.statusCode) &&
    isNumber(e.durationMs) &&
    isString(e.timestamp) &&
    !Number.isNaN(Date.parse(e.timestamp)) &&
    (e.metadata === undefined || (typeof e.metadata === 'object' && e.metadata !== null))
  );
}
