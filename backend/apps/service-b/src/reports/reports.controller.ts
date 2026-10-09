import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TrackAction } from '@app/common';
import { ReportQueryDto } from './dto/report-query.dto';
import type { GenerateReportRequest } from './report.grpc';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('pdf')
  @TrackAction('reports.pdf')
  @ApiOperation({
    summary: 'Generate a PDF report with charts',
    description:
      'Reads RedisTimeSeries (TS.MRANGE FILTER service=<source> metric=requests AGGREGATION SUM bucketMs) and ' +
      'a per-action log summary from MongoDB, then renders the PDF through the Go report service (gRPC).',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF document', schema: { type: 'string', format: 'binary' } })
  @ApiServiceUnavailableResponse({ description: 'Report service unreachable' })
  @ApiBadGatewayResponse({ description: 'Report service failed' })
  async pdf(@Query() q: ReportQueryDto): Promise<StreamableFile> {
    const report = await this.reports.generatePdf(q);
    return new StreamableFile(report.pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${report.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      length: report.pdf.length,
    });
  }

  @Get('data')
  @TrackAction('reports.data')
  @ApiOperation({ summary: 'Report input data as JSON (same payload sent to the report service)' })
  data(@Query() q: ReportQueryDto): Promise<GenerateReportRequest> {
    return this.reports.buildRequest(q);
  }
}
