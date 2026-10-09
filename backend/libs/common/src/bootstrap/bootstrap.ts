import { ConsoleLogger, INestApplication, LogLevel, Logger, Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '../http/all-exceptions.filter';
import { LOG_LEVELS, LogLevelName } from '../config/env.validation';

export interface HttpAppOptions {
  serviceName: string;
  title: string;
  description: string;
  version?: string;
}

function logLevelsFrom(level: string | undefined): LogLevel[] {
  const idx = LOG_LEVELS.indexOf((level ?? 'log') as LogLevelName);
  return LOG_LEVELS.slice(0, idx < 0 ? 3 : idx + 1);
}

export async function createHttpApp(module: Type<unknown>, opts: HttpAppOptions): Promise<INestApplication> {
  const logger = new ConsoleLogger({
    prefix: opts.serviceName,
    json: process.env.LOG_FORMAT === 'json',
    logLevels: logLevelsFrom(process.env.LOG_LEVEL),
    colors: process.env.LOG_FORMAT !== 'json',
  });

  const app = await NestFactory.create(module, { logger, bufferLogs: true });
  app.enableShutdownHooks();
  app.enableCors();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle(opts.title)
    .setDescription(opts.description)
    .setVersion(opts.version ?? '1.0.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  });
  return app;
}

export async function listen(app: INestApplication, port: number, serviceName: string): Promise<void> {
  await app.listen(port, '0.0.0.0');
  Logger.log(`${serviceName} listening on :${port} (Swagger: /docs)`, 'Bootstrap');
}
