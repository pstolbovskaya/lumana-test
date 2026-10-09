import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Response } from 'express';
import { addEventMetadata, ApiEventPublisher, TrackAction } from '@app/common';
import type { TrackedRequest } from '@app/common';
import { DatasetStorage } from './dataset-storage';
import { FetchDatasetDto, IngestFileDto, UploadDatasetDto } from './dto/datasets.dto';
import { FetchJobsRegistry } from './fetch-jobs.registry';
import type { FetchJob } from './fetch-jobs.registry';
import { FetchService } from './fetch.service';
import { IngestService } from './ingest.service';
import type { IngestSummary } from './ingest.service';
import { formatFromFileName } from './parsers';
import { ConfigService } from '@nestjs/config';

@ApiTags('datasets')
@Controller('datasets')
export class DatasetsController {
  private readonly defaultPages: number;

  constructor(
    private readonly fetchService: FetchService,
    private readonly jobs: FetchJobsRegistry,
    private readonly ingestService: IngestService,
    private readonly storage: DatasetStorage,
    private readonly publisher: ApiEventPublisher,
    config: ConfigService,
  ) {
    this.defaultPages = config.getOrThrow<number>('FETCH_DEFAULT_PAGES');
  }

  @Post('fetch')
  @TrackAction('datasets.fetch')
  @ApiOperation({
    summary: 'Download the Steam catalog from SteamSpy into a file',
    description:
      'Fetches SteamSpy `request=all` pages (1000 games each) one at a time, at most one request per ' +
      'STEAMSPY_MIN_INTERVAL_MS (60 s by default; retries included), streaming rows into JSON and/or XLSX under ' +
      'DATA_DIR/exports. Stops at the first empty page (end of catalog). Runs as a background job: poll ' +
      '`GET /datasets/jobs/:id` for `progress.pagesDone`, `nextRequestAt` and `estimatedCompletionAt`.',
  })
  @ApiAcceptedResponse({ description: 'Job started (wait=false)' })
  @ApiOkResponse({ description: 'Job finished (wait=true)' })
  @ApiConflictResponse({ description: 'A running job already writes the same fileName' })
  async fetch(
    @Body() dto: FetchDatasetDto,
    @Req() req: TrackedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FetchJob> {
    const { job, done } = this.fetchService.start({
      pages: dto.pages ?? this.defaultPages,
      startPage: dto.startPage,
      format: dto.format,
      baseName: dto.fileName,
    });
    addEventMetadata(req, { jobId: job.id });

    const finished = done.then(async (j) => {
      await this.publisher.publishCustom(
        j.status === 'completed' ? 'job.completed' : 'job.failed',
        'datasets.fetch.job',
        { jobId: j.id, status: j.status, progress: j.progress, files: j.result?.files, error: j.error },
        {
          statusCode: j.status === 'completed' ? 200 : j.status === 'cancelled' ? 499 : 500,
          durationMs:
            j.result?.durationMs ?? (j.finishedAt ? j.finishedAt.getTime() - j.createdAt.getTime() : 0),
        },
      );
      return j;
    });

    if (!dto.wait) {
      res.status(HttpStatus.ACCEPTED);
      return job;
    }
    const result = await finished;
    addEventMetadata(req, {
      records: result.result?.records,
      files: result.result?.files.map((f) => f.name),
    });
    res.status(result.status === 'completed' ? HttpStatus.OK : HttpStatus.BAD_GATEWAY);
    return result;
  }

  @Delete('jobs/:id')
  @TrackAction('datasets.jobs.cancel')
  @ApiOperation({ summary: 'Cancel a running fetch job (its partial files are discarded)' })
  @ApiConflictResponse({ description: 'The job is not running' })
  cancelJob(@Param('id') id: string): FetchJob {
    return this.jobs.cancel(id);
  }

  @Get('jobs')
  @TrackAction('datasets.jobs.list')
  @ApiOperation({ summary: 'List recent fetch jobs' })
  listJobs(): FetchJob[] {
    return this.jobs.list();
  }

  @Get('jobs/:id')
  @TrackAction('datasets.jobs.get')
  @ApiOperation({ summary: 'Get fetch job status / result' })
  getJob(@Param('id') id: string): FetchJob {
    return this.jobs.get(id);
  }

  @Get('files')
  @TrackAction('datasets.files.list')
  @ApiOperation({ summary: 'List exported dataset files' })
  listFiles() {
    return this.storage.listExports();
  }

  @Get('files/:fileName')
  @TrackAction('datasets.files.download')
  @ApiOperation({ summary: 'Download an exported dataset file' })
  async download(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.storage.resolveExport(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(createReadStream(file.path), {
      type:
        file.format === 'json'
          ? 'application/json'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      length: file.sizeBytes,
    });
  }

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @TrackAction('datasets.ingest')
  @ApiOperation({ summary: 'Ingest a previously fetched file (by name) into MongoDB' })
  @ApiUnprocessableEntityResponse({
    description: 'File could not be parsed; body contains the partial summary',
  })
  async ingest(@Body() dto: IngestFileDto, @Req() req: TrackedRequest): Promise<IngestSummary> {
    const file = await this.storage.resolveExport(dto.fileName);
    const summary = await this.ingestService.ingestFile(file.path, file.format, `file:${dto.fileName}`);
    return this.finish(summary, req);
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @TrackAction('datasets.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDatasetDto })
  @ApiOperation({
    summary: 'Upload a .json or .xlsx file and ingest it into MongoDB',
    description: 'The upload is spooled to disk (size limited by MAX_UPLOAD_MB) and parsed as a stream.',
  })
  @ApiPayloadTooLargeResponse()
  @ApiUnprocessableEntityResponse()
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: TrackedRequest,
  ): Promise<IngestSummary> {
    if (!file) throw new BadRequestException('Multipart field "file" is required');
    try {
      const format = formatFromFileName(file.originalname);
      if (!format) throw new BadRequestException('Only .json and .xlsx files are supported');
      const summary = await this.ingestService.ingestFile(file.path, format, `upload:${file.originalname}`);
      return this.finish(summary, req);
    } finally {
      await rm(file.path, { force: true });
    }
  }

  private finish(summary: IngestSummary, req: TrackedRequest): IngestSummary {
    addEventMetadata(req, {
      ingest: {
        source: summary.source,
        status: summary.status,
        totalRows: summary.totalRows,
        inserted: summary.inserted,
        updated: summary.updated,
        invalidRows: summary.invalidRows,
      },
    });
    if (summary.status === 'failed') {
      throw new UnprocessableEntityException({
        message: summary.failureReason ?? 'Ingest failed',
        error: 'Unprocessable Entity',
        summary,
      });
    }
    return summary;
  }
}
