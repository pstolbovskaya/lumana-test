import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { humanizeSeriesLabel, sanitizeSegment, TimeSeriesService } from '@app/common';
import { LogsRepository } from '../logs/logs.repository';
import {
  GenerateReportRequest,
  REPORT_GRPC_CLIENT,
  REPORT_SERVICE,
  ReportServiceClient,
} from './report.grpc';
import { capSeries, ReportWindowError, resolveReportWindow, zeroFillBuckets } from './report-window';

const MAX_SERIES = 100;
import type { ReportQueryDto } from './dto/report-query.dto';

export interface GeneratedReport {
  pdf: Buffer;
  filename: string;
}

@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);
  private reportClient!: ReportServiceClient;
  private readonly timeoutMs: number;
  private readonly sourceService: string;

  constructor(
    @Inject(REPORT_GRPC_CLIENT) private readonly grpc: ClientGrpc,
    private readonly timeSeries: TimeSeriesService,
    private readonly logs: LogsRepository,
    config: ConfigService,
  ) {
    this.timeoutMs = config.getOrThrow<number>('REPORT_TIMEOUT_MS');
    this.sourceService = config.getOrThrow<string>('REPORT_SOURCE_SERVICE');
  }

  onModuleInit(): void {
    this.reportClient = this.grpc.getService<ReportServiceClient>(REPORT_SERVICE);
  }

  async buildRequest(q: ReportQueryDto): Promise<GenerateReportRequest> {
    let window;
    try {
      window = resolveReportWindow(q);
    } catch (err) {
      if (err instanceof ReportWindowError) throw new BadRequestException(err.message);
      throw err;
    }
    const service = sanitizeSegment(this.sourceService);
    const [series, summary] = await Promise.all([
      this.timeSeries.mrange({
        fromMs: window.fromMs,
        toMs: window.toMs,
        bucketMs: window.bucketMs,
        filters: [`service=${service}`, 'metric=requests'],
        aggregation: 'SUM',
      }),
      this.logs.countByAction({
        service: this.sourceService,
        from: new Date(window.fromMs),
        to: new Date(window.toMs),
      }),
    ]);
    return {
      title: q.title ?? `${this.sourceService} activity report`,
      fromMs: window.fromMs,
      toMs: window.toMs,
      bucketMs: window.bucketMs,
      series: capSeries(
        series.map((s) => ({
          key: s.key,
          label: humanizeSeriesLabel(s.labels, s.key),
          labels: s.labels,
          points: zeroFillBuckets(s.points, window),
        })),
        MAX_SERIES,
      ),
      logSummary: summary,
    };
  }

  async generatePdf(q: ReportQueryDto): Promise<GeneratedReport> {
    const request = await this.buildRequest(q);
    const started = Date.now();
    try {
      const res = await firstValueFrom(
        this.reportClient
          .generateReport(request, new Metadata(), { deadline: new Date(Date.now() + this.timeoutMs) })
          .pipe(timeout(this.timeoutMs + 1_000)),
      );
      const pdf = Buffer.isBuffer(res.pdf) ? res.pdf : Buffer.from(res.pdf ?? []);
      if (pdf.length === 0) throw new BadGatewayException('Report service returned an empty PDF');
      this.logger.log(
        `Report generated: ${request.series.length} series, ${pdf.length} bytes in ${Date.now() - started}ms`,
      );
      return { pdf, filename: res.filename || `report-${request.fromMs}-${request.toMs}.pdf` };
    } catch (err) {
      throw this.mapGrpcError(err);
    }
  }

  private mapGrpcError(err: unknown): Error {
    if (err instanceof BadGatewayException) return err;
    if (err instanceof TimeoutError) return new GatewayTimeoutException('Report service timed out');
    const code = (err as { code?: number }).code;
    const details =
      (err as { details?: string }).details ?? (err instanceof Error ? err.message : String(err));
    this.logger.error(`Report service call failed (code=${code ?? 'n/a'}): ${details}`);
    switch (code) {
      case GrpcStatus.UNAVAILABLE:
        return new ServiceUnavailableException('Report service is unavailable');
      case GrpcStatus.DEADLINE_EXCEEDED:
        return new GatewayTimeoutException('Report service timed out');
      case GrpcStatus.INVALID_ARGUMENT:
        return new BadRequestException(`Report service rejected the request: ${details}`);
      default:
        return new BadGatewayException(`Report service error: ${details}`);
    }
  }
}
