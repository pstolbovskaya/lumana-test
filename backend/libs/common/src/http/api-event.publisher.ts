import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { API_EVENT_PATTERN, ApiEvent, EVENTS_CLIENT } from '../events/api-event.contract';
import { TimeSeriesService } from '../timeseries/timeseries.service';
import { buildTsKey, buildTsLabels, statusClassOf } from '../timeseries/ts-key.util';
import { API_TRACKING_OPTIONS } from './api-tracking.options';
import type { ApiTrackingOptions } from './api-tracking.options';

@Injectable()
export class ApiEventPublisher {
  private readonly logger = new Logger(ApiEventPublisher.name);

  constructor(
    private readonly timeSeries: TimeSeriesService,
    @Inject(API_TRACKING_OPTIONS) private readonly options: ApiTrackingOptions,
    @Optional() @Inject(EVENTS_CLIENT) private readonly events?: ClientProxy,
  ) {}

  async publishCustom(
    type: ApiEvent['type'],
    action: string,
    metadata: Record<string, unknown>,
    opts: { statusCode?: number; durationMs?: number } = {},
  ): Promise<void> {
    await this.publish({
      id: randomUUID(),
      type,
      service: this.options.service,
      action,
      method: 'JOB',
      path: '-',
      statusCode: opts.statusCode ?? 200,
      durationMs: opts.durationMs ?? 0,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  async publish(event: ApiEvent): Promise<void> {
    const status = statusClassOf(event.statusCode);
    const parts = { service: event.service, action: event.action, status };
    const tasks: Promise<unknown>[] = [
      this.timeSeries.add({
        key: buildTsKey(parts),
        value: 1,
        timestampMs: Date.parse(event.timestamp),
        labels: buildTsLabels(parts),
        retentionMs: this.options.retentionMs,
      }),
    ];
    if (this.options.emitEvents && this.events) {
      const client = this.events;
      tasks.push(
        new Promise<void>((resolve, reject) => {
          client
            .emit<void, ApiEvent>(API_EVENT_PATTERN, event)
            .subscribe({ complete: resolve, error: reject });
        }),
      );
    }
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.warn(`Failed to record event ${event.action}: ${reason}`);
      }
    }
  }
}
