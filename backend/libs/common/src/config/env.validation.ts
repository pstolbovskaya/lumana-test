import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

export class BaseEnv {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  SERVICE_NAME!: string;

  @IsString()
  @IsNotEmpty()
  MONGO_URI: string = 'mongodb://localhost:27017';

  @IsString()
  @IsNotEmpty()
  MONGO_DB!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL: string = 'redis://localhost:6379';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TS_RETENTION_MS: number = 7 * 24 * 60 * 60 * 1000;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevelName = 'log';

  @IsOptional()
  @IsIn(['text', 'json'])
  LOG_FORMAT: 'text' | 'json' = 'text';
}

export function createEnvValidator<T extends object>(
  envClass: new () => T,
): (config: Record<string, unknown>) => T {
  return (config) => {
    const instance = plainToInstance(envClass, config, {
      enableImplicitConversion: false,
      exposeDefaultValues: true,
    });
    const errors = validateSync(instance, { skipMissingProperties: false });
    if (errors.length > 0) {
      const details = errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${details}`);
    }
    return instance;
  };
}
