import type { Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export const REPORT_GRPC_CLIENT = Symbol('REPORT_GRPC_CLIENT');
export const REPORT_PACKAGE = 'report';
export const REPORT_SERVICE = 'ReportService';

export interface DataPoint {
  timestampMs: number;
  value: number;
}

export interface Series {
  key: string;
  label: string;
  labels: Record<string, string>;
  points: DataPoint[];
}

export interface LogSummary {
  type: string;
  count: number;
}

export interface GenerateReportRequest {
  title: string;
  fromMs: number;
  toMs: number;
  bucketMs: number;
  series: Series[];
  logSummary: LogSummary[];
}

export interface GenerateReportResponse {
  pdf: Buffer;
  filename: string;
}

export interface ReportServiceClient {
  generateReport(
    request: GenerateReportRequest,
    metadata?: Metadata,
    options?: { deadline?: Date },
  ): Observable<GenerateReportResponse>;
}
