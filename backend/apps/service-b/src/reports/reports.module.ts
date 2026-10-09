import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { isAbsolute, resolve } from 'node:path';
import { TimeSeriesModule } from '@app/common';
import { LogsModule } from '../logs/logs.module';
import { REPORT_GRPC_CLIENT, REPORT_PACKAGE } from './report.grpc';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    LogsModule,
    TimeSeriesModule,
    ClientsModule.registerAsync([
      {
        name: REPORT_GRPC_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const protoPath = config.getOrThrow<string>('REPORT_PROTO_PATH');
          return {
            transport: Transport.GRPC,
            options: {
              package: REPORT_PACKAGE,
              protoPath: isAbsolute(protoPath) ? protoPath : resolve(process.cwd(), protoPath),
              url: config.getOrThrow<string>('REPORT_GRPC_URL'),
              maxReceiveMessageLength: 64 * 1024 * 1024,
              loader: { keepCase: false, longs: Number, enums: String, defaults: true, arrays: true },
            },
          };
        },
      },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
