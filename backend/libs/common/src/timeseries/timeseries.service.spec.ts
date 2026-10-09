import { normalizeMRangeReply } from './timeseries.service';

describe('normalizeMRangeReply', () => {
  it('handles object replies (RESP3 default mapping)', () => {
    const reply = {
      'events:service-a:x:2xx': {
        labels: { service: 'service-a', action: 'x' },
        samples: [
          { timestamp: 1000, value: 2 },
          { timestamp: 2000, value: 3 },
        ],
      },
    };
    expect(normalizeMRangeReply(reply)).toEqual([
      {
        key: 'events:service-a:x:2xx',
        labels: { service: 'service-a', action: 'x' },
        points: [
          { timestampMs: 1000, value: 2 },
          { timestampMs: 2000, value: 3 },
        ],
      },
    ]);
  });

  it('handles Map replies and Map labels', () => {
    const reply = new Map([
      ['k', { labels: new Map([['a', 'b']]), samples: [{ timestamp: '5', value: '1.5' }] }],
    ]);
    expect(normalizeMRangeReply(reply)).toEqual([
      { key: 'k', labels: { a: 'b' }, points: [{ timestampMs: 5, value: 1.5 }] },
    ]);
  });

  it('handles empty replies', () => {
    expect(normalizeMRangeReply(null)).toEqual([]);
    expect(normalizeMRangeReply({})).toEqual([]);
  });
});
