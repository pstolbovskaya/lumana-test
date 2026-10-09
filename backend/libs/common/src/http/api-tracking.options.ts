export const API_TRACKING_OPTIONS = Symbol('API_TRACKING_OPTIONS');

export interface ApiTrackingOptions {
  service: string;
  retentionMs: number;
  emitEvents: boolean;
}
