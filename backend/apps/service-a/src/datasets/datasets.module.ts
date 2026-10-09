import { BadRequestException, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { diskStorage } from 'multer';
import { GamesModule } from '../games/games.module';
import { DatasetStorage } from './dataset-storage';
import { DatasetsController } from './datasets.controller';
import { FetchJobsRegistry } from './fetch-jobs.registry';
import { FetchService } from './fetch.service';
import { IngestService } from './ingest.service';
import { formatFromFileName } from './parsers';
import { SteamSpyClient } from './steamspy.client';

@Module({
  imports: [
    GamesModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: diskStorage({
          destination: join(resolve(config.getOrThrow<string>('DATA_DIR')), 'uploads'),
          filename: (_req, file, cb) =>
            cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
        }),
        limits: { fileSize: config.getOrThrow<number>('MAX_UPLOAD_MB') * 1024 * 1024, files: 1 },
        fileFilter: (_req, file, cb) => {
          if (formatFromFileName(file.originalname)) cb(null, true);
          else cb(new BadRequestException('Only .json and .xlsx files are supported'), false);
        },
      }),
    }),
  ],
  controllers: [DatasetsController],
  providers: [SteamSpyClient, DatasetStorage, FetchJobsRegistry, FetchService, IngestService],
})
export class DatasetsModule {}
