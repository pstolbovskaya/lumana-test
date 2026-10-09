import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { createHttpApp, listen, parseRedisUrl } from '@app/common';
import { ServiceBModule } from './service-b.module';

async function bootstrap(): Promise<void> {
  const app = await createHttpApp(ServiceBModule, {
    serviceName: 'service-b',
    title: 'Service B — Event logs & reports',
    description:
      'Consumes API events from Service A (Redis transporter), stores them in MongoDB, exposes log query / stats ' +
      'APIs and generates PDF reports from RedisTimeSeries via the Go report service (gRPC).',
  });
  const config = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.REDIS,
      options: {
        ...parseRedisUrl(config.getOrThrow<string>('REDIS_URL')),
        retryAttempts: 10,
        retryDelay: 1_000,
      },
    },
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();
  await listen(app, config.getOrThrow<number>('PORT'), 'service-b');
}

void bootstrap();
