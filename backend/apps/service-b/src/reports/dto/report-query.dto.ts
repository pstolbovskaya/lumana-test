import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TimeQueryParam } from '@app/common';

export class ReportQueryDto {
  @ApiPropertyOptional({ description: 'Window start, ISO-8601 or epoch ms (default: to - 1h)' })
  @TimeQueryParam()
  from?: Date;

  @ApiPropertyOptional({ description: 'Window end, ISO-8601 or epoch ms (default: now)' })
  @TimeQueryParam()
  to?: Date;

  @ApiPropertyOptional({
    description: 'Aggregation bucket in ms (default: auto, ~60 buckets)',
    example: 60000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30 * 86_400_000)
  bucketMs?: number;

  @ApiPropertyOptional({ description: 'Report title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
