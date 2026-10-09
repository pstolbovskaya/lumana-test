import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface FetchProgress {
  pagesTotal: number;
  pagesDone: number;
  pagesFailed: number;
  records: number;
  currentPage: number | null;
  nextRequestAt: string | null;
  estimatedCompletionAt: string | null;
  retries: number;
  lastError: string | null;
  endOfCatalog: boolean;
}

export interface FetchResult {
  files: Array<{ name: string; format: 'json' | 'xlsx'; sizeBytes: number }>;
  records: number;
  pagesRequested: number;
  pagesFetched: number;
  failedPages: Array<{ page: number; error: string }>;
  endOfCatalog: boolean;
  durationMs: number;
}

export interface FetchJob {
  id: string;
  status: JobStatus;
  fileName: string;
  startPage: number;
  rateLimitMs: number;
  createdAt: Date;
  finishedAt?: Date;
  progress: FetchProgress;
  result?: FetchResult;
  error?: string;
}

const MAX_JOBS = 50;

@Injectable()
export class FetchJobsRegistry {
  private readonly jobs = new Map<string, FetchJob>();
  private readonly controllers = new Map<string, AbortController>();

  create(init: { fileName: string; pagesTotal: number; startPage: number; rateLimitMs: number }): {
    job: FetchJob;
    signal: AbortSignal;
  } {
    const clash = this.findRunningByFileName(init.fileName);
    if (clash) {
      throw new ConflictException({
        error: 'Conflict',
        message: `Fetch job ${clash.id} is already writing "${init.fileName}"; wait for it or choose another fileName`,
        jobId: clash.id,
      });
    }
    const job: FetchJob = {
      id: randomUUID(),
      status: 'running',
      fileName: init.fileName,
      startPage: init.startPage,
      rateLimitMs: init.rateLimitMs,
      createdAt: new Date(),
      progress: {
        pagesTotal: init.pagesTotal,
        pagesDone: 0,
        pagesFailed: 0,
        records: 0,
        currentPage: null,
        nextRequestAt: null,
        estimatedCompletionAt: null,
        retries: 0,
        lastError: null,
        endOfCatalog: false,
      },
    };
    const controller = new AbortController();
    this.jobs.set(job.id, job);
    this.controllers.set(job.id, controller);
    this.evict();
    return { job, signal: controller.signal };
  }

  findRunningByFileName(fileName: string): FetchJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && job.fileName === fileName) return job;
    }
    return undefined;
  }

  get(id: string): FetchJob {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  list(): FetchJob[] {
    return [...this.jobs.values()].reverse();
  }

  cancel(id: string): FetchJob {
    const job = this.get(id);
    if (job.status !== 'running') {
      throw new ConflictException(`Job ${id} is already ${job.status}`);
    }
    this.controllers.get(id)?.abort(new JobCancelledError(id));
    return job;
  }

  release(id: string): void {
    this.controllers.delete(id);
  }

  private evict(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running') {
        this.jobs.delete(id);
        if (this.jobs.size <= MAX_JOBS) return;
      }
    }
  }
}

export class JobCancelledError extends Error {
  constructor(id: string) {
    super(`Job ${id} was cancelled`);
    this.name = 'JobCancelledError';
  }
}
