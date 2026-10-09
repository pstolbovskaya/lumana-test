import { DynamicModule, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { EVENTS_CLIENT } from '../events/api-event.contract';
import { parseRedisUrl } from '../redis/redis-url.util';
import { TimeSeriesModule } from '../timeseries/timeseries.module';
import { ApiTrackingInterceptor } from './api-tracking.interceptor';
import { API_TRACKING_OPTIONS, ApiTrackingOptions } from './api-tracking.options';
import { ApiEventPublisher } from './api-event.publisher';
import { RequestIdMiddleware } from './request-id.middleware';

export interface ApiTrackingModuleOptions {
  emitEvents: boolean;
}

@Module({})
export class ApiTrackingModule implements NestModule {
  static forRoot(options: ApiTrackingModuleOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: API_TRACKING_OPTIONS,
        inject: [ConfigService],
        useFactory: (config: ConfigService): ApiTrackingOptions => ({
          service: config.getOrThrow<string>('SERVICE_NAME'),
          retentionMs: config.getOrThrow<number>('TS_RETENTION_MS'),
          emitEvents: options.emitEvents,
        }),
      },
      ApiEventPublisher,
      { provide: APP_INTERCEPTOR, useClass: ApiTrackingInterceptor },
    ];
    const imports: DynamicModule['imports'] = [TimeSeriesModule];
    if (options.emitEvents) {
      imports.push(
        ClientsModule.registerAsync([
          {
            name: EVENTS_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              transport: Transport.REDIS,
              options: {
                ...parseRedisUrl(config.getOrThrow<string>('REDIS_URL')),
                retryAttempts: 10,
                retryDelay: 1_000,
              },
            }),
          },
        ]),
      );
    }
    return { module: ApiTrackingModule, global: true, imports, providers, exports: [ApiEventPublisher] };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
