import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function grantTimes(limiter: RateLimiter, n: number, signal?: AbortSignal): number[] {
    const t0 = Date.now();
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      void limiter.acquire(signal).then(
        () => times.push(Date.now() - t0),
        () => times.push(-1),
      );
    }
    return times;
  }

  it('grants the first request immediately and spaces the rest by the interval', async () => {
    const limiter = new RateLimiter(60_000);
    const times = grantTimes(limiter, 3);
    await jest.advanceTimersByTimeAsync(0);
    expect(times).toEqual([0]);
    await jest.advanceTimersByTimeAsync(59_999);
    expect(times).toEqual([0]);
    await jest.advanceTimersByTimeAsync(1);
    expect(times).toEqual([0, 60_000]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(times).toEqual([0, 60_000, 120_000]);
    expect(limiter.nextRequestAt - Date.now()).toBe(60_000);
  });

  it('does not wait when the previous request is older than the interval', async () => {
    const limiter = new RateLimiter(1_000);
    await limiter.acquire();
    await jest.advanceTimersByTimeAsync(5_000);
    const times = grantTimes(limiter, 1);
    await jest.advanceTimersByTimeAsync(0);
    expect(times).toEqual([0]);
  });

  it('defer() pushes the next slot out (backoff) but never pulls it in', async () => {
    const limiter = new RateLimiter(60_000);
    await limiter.acquire();
    limiter.defer(10_000);
    expect(limiter.nextRequestAt - Date.now()).toBe(60_000);
    limiter.defer(90_000);
    const times = grantTimes(limiter, 1);
    await jest.advanceTimersByTimeAsync(89_999);
    expect(times).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(times).toEqual([90_000]);
  });

  it('honours a defer() issued while a caller is already waiting', async () => {
    const limiter = new RateLimiter(1_000);
    await limiter.acquire();
    const times = grantTimes(limiter, 1);
    await jest.advanceTimersByTimeAsync(500);
    limiter.defer(2_000);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(times).toEqual([]);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(times).toEqual([2_500]);
  });

  it('an aborted waiter rejects and frees the queue for the next caller', async () => {
    const limiter = new RateLimiter(10_000);
    await limiter.acquire();
    const ac = new AbortController();
    const aborted = grantTimes(limiter, 1, ac.signal);
    const next = grantTimes(limiter, 1);
    await jest.advanceTimersByTimeAsync(1_000);
    ac.abort(new Error('cancel'));
    await jest.advanceTimersByTimeAsync(0);
    expect(aborted).toEqual([-1]);
    await jest.advanceTimersByTimeAsync(9_000);
    expect(next).toEqual([10_000]);
  });

  it('interval 0 never waits', async () => {
    const limiter = new RateLimiter(0);
    const times = grantTimes(limiter, 3);
    await jest.advanceTimersByTimeAsync(0);
    expect(times).toEqual([0, 0, 0]);
  });
});
