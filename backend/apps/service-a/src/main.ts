import { ConfigService } from '@nestjs/config';
import { createHttpApp, listen } from '@app/common';
import { ServiceAModule } from './service-a.module';

async function bootstrap(): Promise<void> {
  const app = await createHttpApp(ServiceAModule, {
    serviceName: 'service-a',
    title: 'Service A — Steam games',
    description:
      'Fetches the Steam games catalog from SteamSpy (rate limited, 1 request per minute) into JSON/XLSX files, ' +
      'ingests JSON/XLSX into MongoDB and serves a cursor-paginated search API. Every API call is recorded in ' +
      'RedisTimeSeries and published to Service B.',
  });
  const config = app.get(ConfigService);
  await listen(app, config.getOrThrow<number>('PORT'), 'service-a');
}

void bootstrap();
