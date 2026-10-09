import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { backoffDelay } from '@app/common';
import type { RawGame } from '../games/game.types';
import { RateLimiter } from './rate-limiter';

export interface SteamSpyPage {
  page: number;
  games: RawGame[];
}

export interface RetryInfo {
  page: number;
  attempt: number;
  maxRetries: number;
  error: string;
  nextRequestAt: number;
}

export interface FetchPageOptions {
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
}

export class SteamSpyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 300_000;

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function parseAllPage(body: unknown): RawGame[] {
  if (Array.isArray(body) && body.length === 0) return [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SteamSpyRequestError('Malformed response: expected an object keyed by appid', null, true);
  }
  const games: RawGame[] = [];
  for (const [key, row] of Object.entries(body as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !row || typeof row !== 'object' || Array.isArray(row)) {
      throw new SteamSpyRequestError(
        `Malformed response: unexpected entry "${key.slice(0, 40)}"`,
        null,
        true,
      );
    }
    games.push(row as RawGame);
  }
  return games;
}

@Injectable()
export class SteamSpyClient {
  private readonly logger = new Logger(SteamSpyClient.name);
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  readonly limiter: RateLimiter;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('STEAMSPY_BASE_URL');
    this.maxRetries = config.getOrThrow<number>('FETCH_MAX_RETRIES');
    this.timeoutMs = config.getOrThrow<number>('STEAMSPY_TIMEOUT_MS');
    this.userAgent = config.getOrThrow<string>('FETCH_USER_AGENT');
    this.limiter = new RateLimiter(config.getOrThrow<number>('STEAMSPY_MIN_INTERVAL_MS'));
  }

  buildPageUrl(page: number): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('request', 'all');
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  async fetchPage(page: number, opts: FetchPageOptions = {}): Promise<SteamSpyPage> {
    const { signal } = opts;
    let attempt = 0;
    for (;;) {
      await this.limiter.acquire(signal);
      try {
        return { page, games: await this.fetchOnce(page, signal) };
      } catch (err) {
        if (signal?.aborted) throw signal.reason;
        const e =
          err instanceof SteamSpyRequestError
            ? err
            : new SteamSpyRequestError(err instanceof Error ? err.message : String(err), null, true);
        if (!e.retryable || attempt >= this.maxRetries) throw e;
        const delay = Math.max(e.retryAfterMs ?? 0, backoffDelay(attempt, BACKOFF_BASE_MS, BACKOFF_CAP_MS));
        this.limiter.defer(delay);
        attempt++;
        const nextRequestAt = this.limiter.nextRequestAt;
        this.logger.warn(
          `SteamSpy page ${page} failed (${e.message}); retry ${attempt}/${this.maxRetries} at ` +
            new Date(nextRequestAt).toISOString(),
        );
        opts.onRetry?.({ page, attempt, maxRetries: this.maxRetries, error: e.message, nextRequestAt });
      }
    }
  }

  private async fetchOnce(page: number, signal?: AbortSignal): Promise<RawGame[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await fetch(this.buildPageUrl(page), {
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
      await res.body?.cancel();
      throw new SteamSpyRequestError(
        `HTTP ${res.status}`,
        res.status,
        retryable,
        parseRetryAfter(res.headers.get('retry-after')),
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SteamSpyRequestError(
        `Malformed response: not JSON (${text.slice(0, 60).replace(/\s+/g, ' ')})`,
        res.status,
        true,
      );
    }
    return parseAllPage(body);
  }
}
