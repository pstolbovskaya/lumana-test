import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { parseAllPage, parseRetryAfter, SteamSpyClient, SteamSpyRequestError } from './steamspy.client';

const env: Record<string, unknown> = {
  STEAMSPY_BASE_URL: 'https://steamspy.test/api.php',
  FETCH_MAX_RETRIES: 2,
  STEAMSPY_TIMEOUT_MS: 5_000,
  FETCH_USER_AGENT: 'test-agent/1.0',
  STEAMSPY_MIN_INTERVAL_MS: 60_000,
};
const config = { getOrThrow: (k: string) => env[k] } as unknown as ConfigService;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('parseAllPage', () => {
  it('turns the appid-keyed object into rows; {} or [] is the end of the catalog', () => {
    expect(parseAllPage({ '10': { appid: 10, name: 'CS' }, '20': { appid: 20 } })).toEqual([
      { appid: 10, name: 'CS' },
      { appid: 20 },
    ]);
    expect(parseAllPage({})).toEqual([]);
    expect(parseAllPage([])).toEqual([]);
  });

  it.each([[null], ['text'], [[1, 2]], [{ error: 'rate limited' }], [{ '10': 'x' }]])(
    'rejects malformed body %p as retryable',
    (body) => {
      expect(() => parseAllPage(body)).toThrow(SteamSpyRequestError);
      try {
        parseAllPage(body);
      } catch (e) {
        expect((e as SteamSpyRequestError).retryable).toBe(true);
      }
    },
  );
});

describe('SteamSpyClient.fetchPage', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('requests request=all&page=N with a descriptive User-Agent', async () => {
    fetchMock.mockResolvedValueOnce(json({ '730': { appid: 730 } }));
    const client = new SteamSpyClient(config);
    await expect(client.fetchPage(3)).resolves.toEqual({ page: 3, games: [{ appid: 730 }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://steamspy.test/api.php?request=all&page=3');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('test-agent/1.0');
  });

  it('retries 429/5xx through the rate limiter (>= interval and >= Retry-After apart)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '120' }))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ '1': { appid: 1 } }));
    const client = new SteamSpyClient(config);
    const retries: number[] = [];
    const t0 = Date.now();
    const p = client.fetchPage(0, { onRetry: (i) => retries.push(i.nextRequestAt - t0) });
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retries).toEqual([120_000]);
    await jest.advanceTimersByTimeAsync(119_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries[1]).toBeGreaterThanOrEqual(180_000);
    await jest.advanceTimersByTimeAsync(retries[1] - 120_000);
    await expect(p).resolves.toEqual({ page: 0, games: [{ appid: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry other 4xx and gives up after FETCH_MAX_RETRIES', async () => {
    const client = new SteamSpyClient(config);
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(client.fetchPage(0)).rejects.toThrow('HTTP 404');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>busy</html>', { status: 200 })));
    const p = client.fetchPage(1);
    const assertion = expect(p).rejects.toThrow(/not JSON/);
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborting the job signal stops waiting immediately', async () => {
    fetchMock.mockResolvedValue(json({ '1': { appid: 1 } }));
    const client = new SteamSpyClient(config);
    await client.fetchPage(0);
    const ac = new AbortController();
    const p = client.fetchPage(1, { signal: ac.signal });
    const assertion = expect(p).rejects.toThrow('cancelled');
    await jest.advanceTimersByTimeAsync(1_000);
    ac.abort(new Error('cancelled'));
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
