import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { createClient } from 'redis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
const REDIS_OPTIONS = Symbol('REDIS_OPTIONS');

function buildClient(url: string) {
  return createClient({
    url,
    socket: {
      connectTimeout: 10_000,
      reconnectStrategy: (retries: number) => Math.min(retries * 200, 5_000),
    },
  });
}

export type RedisClient = ReturnType<typeof buildClient>;

export interface RedisModuleOptions {
  url: string;
}

export interface RedisModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: any[];
  useFactory: (...args: any[]) => RedisModuleOptions | Promise<RedisModuleOptions>;
}

export const InjectRedis = (): ParameterDecorator & PropertyDecorator => Inject(REDIS_CLIENT);

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('RedisModule');

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      this.logger.log('Closing Redis connection');
      await this.client.close();
    }
  }
}

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: REDIS_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    const clientProvider: Provider = {
      provide: REDIS_CLIENT,
      inject: [REDIS_OPTIONS],
      useFactory: async (opts: RedisModuleOptions): Promise<RedisClient> => {
        const logger = new Logger('RedisModule');
        const client = buildClient(opts.url);
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
        client.on('reconnecting', () => logger.warn('Reconnecting to Redis...'));
        await client.connect();
        logger.log('Connected to Redis');
        return client;
      },
    };
    return {
      module: RedisModule,
      imports: options.imports ?? [],
      providers: [optionsProvider, clientProvider, RedisLifecycle],
      exports: [REDIS_CLIENT],
    };
  }
}
