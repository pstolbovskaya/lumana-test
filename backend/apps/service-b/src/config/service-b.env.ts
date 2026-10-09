import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { BaseEnv } from '@app/common';

export class ServiceBEnv extends BaseEnv {
  override PORT: number = 3002;
  override SERVICE_NAME: string = 'service-b';
  override MONGO_DB: string = 'service_b';

  @IsString()
  @IsNotEmpty()
  REPORT_GRPC_URL: string = 'localhost:50051';

  @IsString()
  @IsNotEmpty()
  REPORT_PROTO_PATH: string = 'proto/report.proto';

  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(300_000)
  REPORT_TIMEOUT_MS: number = 30_000;

  @IsString()
  @IsNotEmpty()
  REPORT_SOURCE_SERVICE: string = 'service-a';
}
