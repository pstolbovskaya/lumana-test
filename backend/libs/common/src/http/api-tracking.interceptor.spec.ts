import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import type { ApiEvent } from '../events/api-event.contract';
import type { ApiEventPublisher } from './api-event.publisher';
import { ApiTrackingInterceptor, deriveActionName } from './api-tracking.interceptor';
import { TRACK_ACTION_KEY } from './track-action.decorator';

describe('deriveActionName', () => {
  it('derives <controller>.<handler>', () => {
    expect(deriveActionName('GamesController', 'search')).toBe('games.search');
    expect(deriveActionName('DatasetFilesController', 'list')).toBe('dataset-files.list');
    expect(deriveActionName('HTTPStatsController', 'get')).toBe('http-stats.get');
  });
});

describe('ApiTrackingInterceptor', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  async function handleRequest(requestId: string): Promise<ApiEvent> {
    const published: ApiEvent[] = [];
    const publisher = { publish: (e: ApiEvent) => Promise.resolve(void published.push(e)) };
    const reflector = {
      getAllAndOverride: (key: string) => (key === TRACK_ACTION_KEY ? 'games.search' : undefined),
    };
    const interceptor = new ApiTrackingInterceptor(
      reflector as unknown as Reflector,
      publisher as unknown as ApiEventPublisher,
      { service: 'service-a', retentionMs: 1000, emitEvents: true },
    );
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
    const req = {
      requestId,
      method: 'GET',
      route: { path: '/games' },
      baseUrl: '',
      path: '/games',
      originalUrl: '/games?q=x',
      query: { q: 'x' },
      params: {},
      ip: '127.0.0.1',
      header: () => undefined,
    };
    const ctx = {
      getType: () => 'http',
      getHandler: () => function search() {},
      getClass: () => class GamesController {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of({ ok: true }) };
    await lastValueFrom(interceptor.intercept(ctx, next));
    res.emit('finish');
    expect(published).toHaveLength(1);
    return published[0];
  }

  it('uses a server-generated event id and keeps the client request id as metadata', async () => {
    const a = await handleRequest('client-chosen-id');
    const b = await handleRequest('client-chosen-id');
    expect(a.id).toMatch(UUID);
    expect(b.id).toMatch(UUID);
    expect(a.id).not.toBe(b.id);
    expect(a.metadata.requestId).toBe('client-chosen-id');
    expect(a).toMatchObject({ action: 'games.search', path: '/games', statusCode: 200 });
  });
});
