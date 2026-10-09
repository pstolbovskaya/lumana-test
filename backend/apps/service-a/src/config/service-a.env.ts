import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUrl, Max, Min } from 'class-validator';
import { BaseEnv } from '@app/common';

export class ServiceAEnv extends BaseEnv {
  override PORT: number = 3001;
  override SERVICE_NAME: string = 'service-a';
  override MONGO_DB: string = 'service_a';

  @IsString()
  DATA_DIR: string = './data';

  @IsUrl({ require_tld: false })
  STEAMSPY_BASE_URL: string = 'https://steamspy.com/api.php';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  STEAMSPY_MIN_INTERVAL_MS: number = 60_000;

  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  STEAMSPY_TIMEOUT_MS: number = 30_000;

  @IsString()
  @IsNotEmpty()
  FETCH_USER_AGENT: string = 'lumana-test-service-a/1.0 (SteamSpy catalog importer; max 1 req/min)';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  FETCH_DEFAULT_PAGES: number = 3;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  FETCH_MAX_PAGES: number = 200;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  FETCH_MAX_RETRIES: number = 4;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1024)
  MAX_UPLOAD_MB: number = 100;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(10_000)
  INGEST_BATCH_SIZE: number = 1000;
}
