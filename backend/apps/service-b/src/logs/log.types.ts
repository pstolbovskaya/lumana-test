import type { ApiEventType } from '@app/common';

export const LOGS_COLLECTION = 'event_logs';

export interface EventLogDocument {
  _id: string;
  type: ApiEventType;
  service: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: Date;
  metadata: Record<string, unknown>;
  receivedAt: Date;
}
