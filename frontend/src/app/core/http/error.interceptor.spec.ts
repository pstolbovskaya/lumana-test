import { HttpErrorResponse, HttpHeaders, provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppHttpError, toAppHttpError } from './app-http-error';
import { errorInterceptor, parseRetryAfter, retryDelayMs } from './error.interceptor';

const httpError = (status: number, headers?: Record<string, string>) =>
  new HttpErrorResponse({ status, headers: new HttpHeaders(headers) });

describe('error interceptor', () => {
  it('backs off exponentially, harder on 429, and honours Retry-After', () => {
    expect(retryDelayMs(httpError(503), 1)).toBe(300);
    expect(retryDelayMs(httpError(503), 2)).toBe(600);
    expect(retryDelayMs(httpError(429), 1)).toBe(1500);
    expect(retryDelayMs(httpError(429), 2)).toBe(3000);
    expect(retryDelayMs(httpError(429, { 'Retry-After': '4' }), 1)).toBe(4000);
    expect(retryDelayMs(httpError(429, { 'Retry-After': '600' }), 1)).toBe(10_000);
  });

  it('does not retry client errors', () => {
    expect(retryDelayMs(httpError(400), 1)).toBeNull();
    expect(retryDelayMs(httpError(404), 1)).toBeNull();
  });

  it('parses Retry-After dates', () => {
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter('nonsense')).toBeNull();
  });

  it('maps 429 to a friendly message', () => {
    expect(toAppHttpError(httpError(429)).message).toMatch(/rate-limiting/);
  });

  it('retries a 429 twice, then surfaces a friendly AppHttpError', () => {
    vi.useFakeTimers();
    try {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(withInterceptors([errorInterceptor])), provideHttpClientTesting()],
      });
      const http = TestBed.inject(HttpClient);
      const ctrl = TestBed.inject(HttpTestingController);
      let error: AppHttpError | undefined;
      http.get('/deals').subscribe({ error: (e: AppHttpError) => (error = e) });

      ctrl.expectOne('/deals').flush(null, { status: 429, statusText: 'Too Many Requests' });
      vi.advanceTimersByTime(1499);
      ctrl.expectNone('/deals');
      vi.advanceTimersByTime(1);
      ctrl.expectOne('/deals').flush(null, { status: 429, statusText: 'Too Many Requests' });
      vi.advanceTimersByTime(3000);
      ctrl.expectOne('/deals').flush(null, { status: 429, statusText: 'Too Many Requests' });

      expect(error?.status).toBe(429);
      expect(error?.message).toMatch(/rate-limiting/);
      ctrl.verify();
    } finally {
      vi.useRealTimers();
    }
  });
});
