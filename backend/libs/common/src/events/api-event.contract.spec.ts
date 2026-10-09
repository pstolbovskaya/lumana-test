import { isApiEvent } from './api-event.contract';

const valid = {
  id: 'abc12345',
  type: 'http.request',
  service: 'service-a',
  action: 'games.search',
  method: 'GET',
  path: '/games',
  statusCode: 200,
  durationMs: 1.5,
  timestamp: new Date().toISOString(),
  metadata: {},
};

describe('isApiEvent', () => {
  it('accepts a valid event', () => expect(isApiEvent(valid)).toBe(true));
  it.each([
    ['null', null],
    ['missing id', { ...valid, id: undefined }],
    ['bad status', { ...valid, statusCode: '200' }],
    ['bad timestamp', { ...valid, timestamp: 'yesterday' }],
    ['bad metadata', { ...valid, metadata: 'x' }],
  ])('rejects %s', (_, value) => expect(isApiEvent(value)).toBe(false));
});
