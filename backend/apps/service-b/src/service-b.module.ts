import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiTrackingModule, createEnvValidator, HealthModule, MongoModule, RedisModule } from '@app/common';
import { ServiceBEnv } from './config/service-b.env';
import { LogsModule } from './logs/logs.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: createEnvValidator(ServiceBEnv) }),
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
    ApiTrackingModule.forRoot({ emitEvents: false }),
    HealthModule,
    LogsModule,
    ReportsModule,
  ],
})
export class ServiceBModule {}
