import {
  buildTsKey,
  buildTsLabels,
  humanizeSeriesLabel,
  sanitizeSegment,
  statusClassOf,
} from './ts-key.util';

describe('ts key utils', () => {
  it('classifies status codes', () => {
    expect(statusClassOf(200)).toBe('2xx');
    expect(statusClassOf(204)).toBe('2xx');
    expect(statusClassOf(302)).toBe('3xx');
    expect(statusClassOf(404)).toBe('4xx');
    expect(statusClassOf(499)).toBe('4xx');
    expect(statusClassOf(503)).toBe('5xx');
    expect(statusClassOf(0)).toBe('other');
  });

  it('sanitizes segments (no separators / spaces / upper case)', () => {
    expect(sanitizeSegment('Games Search')).toBe('games_search');
    expect(sanitizeSegment('a:b:c')).toBe('a_b_c');
    expect(sanitizeSegment('  service-A ')).toBe('service-a');
    expect(sanitizeSegment('datasets.files.list')).toBe('datasets.files.list');
    expect(sanitizeSegment('::')).toBe('unknown');
  });

  it('builds keys and labels', () => {
    const parts = { service: 'service-a', action: 'games.search', status: '2xx' as const };
    expect(buildTsKey(parts)).toBe('events:service-a:games.search:2xx');
    expect(buildTsLabels(parts)).toEqual({
      metric: 'requests',
      service: 'service-a',
      action: 'games.search',
      status: '2xx',
    });
  });

  it('builds human readable labels', () => {
    expect(humanizeSeriesLabel({ action: 'games.search', status: '2xx' }, 'k')).toBe('games.search (2xx)');
    expect(humanizeSeriesLabel({}, 'fallback')).toBe('fallback');
  });
});
