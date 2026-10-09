import type { Request } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface TrackedRequest extends Request {
  requestId?: string;
  eventMetadata?: Record<string, unknown>;
}

export function addEventMetadata(req: TrackedRequest, metadata: Record<string, unknown>): void {
  req.eventMetadata = { ...(req.eventMetadata ?? {}), ...metadata };
}
