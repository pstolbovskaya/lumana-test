import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, retry, throwError, timer } from 'rxjs';
import { toAppHttpError } from './app-http-error';

export const MAX_RETRIES = 2;
const BASE_DELAY_MS = 300;
const RATE_LIMIT_BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 10_000;

function isTransient(error: unknown): error is HttpErrorResponse {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function retryDelayMs(error: unknown, attempt: number): number | null {
  if (!isTransient(error)) return null;
  if (error.status === 429) {
    const retryAfter = parseRetryAfter(error.headers?.get('Retry-After') ?? null);
    return Math.min(MAX_DELAY_MS, retryAfter ?? RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const canRetry = req.method === 'GET';
  return next(req).pipe(
    retry({
      count: canRetry ? MAX_RETRIES : 0,
      delay: (error, attempt) => {
        const delay = retryDelayMs(error, attempt);
        return delay === null ? throwError(() => error) : timer(delay);
      },
    }),
    catchError((error: unknown) => throwError(() => toAppHttpError(error))),
  );
};
