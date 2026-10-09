import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { TrackedRequest } from './request-context';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  requestId?: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<TrackedRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else {
        const {
          message: m,
          error: e,
          ...rest
        } = body as {
          message?: string | string[];
          error?: string;
          statusCode?: number;
        } & Record<string, unknown>;
        delete rest.statusCode;
        message = m ?? exception.message;
        error = e ?? exception.name;
        if (Object.keys(rest).length > 0) details = rest;
      }
    } else {
      this.logger.error(
        `Unhandled error on ${req.method} ${req.originalUrl}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    const payload: ErrorResponseBody = {
      statusCode: status,
      error,
      message,
      path: req.originalUrl,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    };
    res.status(status).json(payload);
  }
}
