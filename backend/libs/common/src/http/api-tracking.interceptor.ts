import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { API_TRACKING_OPTIONS } from './api-tracking.options';
import type { ApiTrackingOptions } from './api-tracking.options';
import { ApiEventPublisher } from './api-event.publisher';
import { SKIP_TRACKING_KEY, TRACK_ACTION_KEY } from './track-action.decorator';
import type { TrackedRequest } from './request-context';

function routePath(req: TrackedRequest): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? `${req.baseUrl}${route.path}` : req.path;
}

export function deriveActionName(controllerName: string, handlerName: string): string {
  const base = controllerName.replace(/Controller$/, '');
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `${kebab}.${handlerName}`;
}

@Injectable()
export class ApiTrackingInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly publisher: ApiEventPublisher,
    @Inject(API_TRACKING_OPTIONS) private readonly options: ApiTrackingOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const handler = context.getHandler();
    const controller = context.getClass();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRACKING_KEY, [handler, controller]);
    if (skip) return next.handle();

    const action =
      this.reflector.getAllAndOverride<string>(TRACK_ACTION_KEY, [handler, controller]) ??
      deriveActionName(controller.name, handler.name);

    const http = context.switchToHttp();
    const req = http.getRequest<TrackedRequest>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();
    const startHr = process.hrtime.bigint();
    let errorMessage: string | undefined;
    let recorded = false;

    const record = (aborted: boolean): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6;
      const statusCode = aborted && !res.writableFinished ? 499 : res.statusCode;
      void this.publisher.publish({
        id: randomUUID(),
        type: 'http.request',
        service: this.options.service,
        action,
        method: req.method,
        path: routePath(req),
        statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        timestamp: new Date(startedAt).toISOString(),
        metadata: {
          ...(req.requestId ? { requestId: req.requestId } : {}),
          url: req.originalUrl,
          query: req.query,
          params: req.params,
          userAgent: req.header('user-agent'),
          ip: req.ip,
          ...(errorMessage ? { error: errorMessage } : {}),
          ...(aborted && !res.writableFinished ? { aborted: true } : {}),
          ...(req.eventMetadata ?? {}),
        },
      });
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(true));

    return next.handle().pipe(
      catchError((err: unknown) => {
        errorMessage = err instanceof HttpException || err instanceof Error ? err.message : String(err);
        return throwError(() => err);
      }),
    );
  }
}
