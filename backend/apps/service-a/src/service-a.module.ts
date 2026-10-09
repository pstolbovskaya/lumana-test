import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiTrackingModule, createEnvValidator, HealthModule, MongoModule, RedisModule } from '@app/common';
import { ServiceAEnv } from './config/service-a.env';
import { DatasetsModule } from './datasets/datasets.module';
import { GamesModule } from './games/games.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: createEnvValidator(ServiceAEnv) }),
    MongoModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
        dbName: config.getOrThrow<string>('MONGO_DB'),
      }),
    }),
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ url: config.getOrThrow<string>('REDIS_URL') }),
    }),
    ApiTrackingModule.forRoot({ emitEvents: true }),
    HealthModule,
    GamesModule,
    DatasetsModule,
  ],
})
export class ServiceAModule {}
