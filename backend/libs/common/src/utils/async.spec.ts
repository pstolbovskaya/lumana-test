import { backoffDelay, sleep } from './async';
import { parseTimeInput } from './time';
import { parseRedisUrl } from '../redis/redis-url.util';

describe('sleep', () => {
  it('rejects early when the signal aborts', async () => {
    const ac = new AbortController();
    const p = sleep(10_000, ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(p).rejects.toThrow('cancelled');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const max = () => 0.999999;
    expect(backoffDelay(0, 100, 10_000, max)).toBe(99);
    expect(backoffDelay(3, 100, 10_000, max)).toBe(799);
    expect(backoffDelay(20, 100, 10_000, max)).toBe(9_999);
    expect(backoffDelay(5, 100, 10_000, () => 0)).toBe(0);
  });
});

describe('parseTimeInput', () => {
  it('parses epoch ms and ISO strings', () => {
    expect(parseTimeInput('1700000000000')?.getTime()).toBe(1_700_000_000_000);
    expect(parseTimeInput('2026-01-01T00:00:00Z')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parseTimeInput(undefined)).toBeUndefined();
    expect(parseTimeInput('')).toBeUndefined();
    expect(parseTimeInput('garbage')).toBeNull();
  });
});

describe('parseRedisUrl', () => {
  it('splits a redis URL', () => {
    expect(parseRedisUrl('redis://user:p%40ss@redis:6380/2')).toEqual({
      host: 'redis',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
    });
    expect(parseRedisUrl('redis://localhost')).toMatchObject({ host: 'localhost', port: 6379 });
    expect(() => parseRedisUrl('http://x')).toThrow();
  });
});
