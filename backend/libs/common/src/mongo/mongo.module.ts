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
import { Db, MongoClient, MongoClientOptions } from 'mongodb';
import { MONGO_CLIENT, MONGO_DB, MONGO_OPTIONS } from './mongo.constants';

export interface MongoModuleOptions {
  uri: string;
  dbName: string;
  clientOptions?: MongoClientOptions;
}

export interface MongoModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: any[];
  useFactory: (...args: any[]) => MongoModuleOptions | Promise<MongoModuleOptions>;
}

export const InjectDb = (): ParameterDecorator & PropertyDecorator => Inject(MONGO_DB);

@Injectable()
class MongoLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('MongoModule');

  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Closing MongoDB connection (signal: ${signal ?? 'n/a'})`);
    await this.client.close();
  }
}

@Global()
@Module({})
export class MongoModule {
  static forRootAsync(options: MongoModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: MONGO_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    const clientProvider: Provider = {
      provide: MONGO_CLIENT,
      inject: [MONGO_OPTIONS],
      useFactory: async (opts: MongoModuleOptions): Promise<MongoClient> => {
        const logger = new Logger('MongoModule');
        const client = new MongoClient(opts.uri, {
          maxPoolSize: 20,
          serverSelectionTimeoutMS: 10_000,
          appName: opts.dbName,
          ...opts.clientOptions,
        });
        await client.connect();
        logger.log(`Connected to MongoDB (db: ${opts.dbName})`);
        return client;
      },
    };
    const dbProvider: Provider = {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, MONGO_OPTIONS],
      useFactory: (client: MongoClient, opts: MongoModuleOptions): Db => client.db(opts.dbName),
    };

    return {
      module: MongoModule,
      imports: options.imports ?? [],
      providers: [optionsProvider, clientProvider, dbProvider, MongoLifecycle],
      exports: [MONGO_CLIENT, MONGO_DB],
    };
  }
}
