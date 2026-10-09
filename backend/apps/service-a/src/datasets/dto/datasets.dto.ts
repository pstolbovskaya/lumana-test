import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type { ExportFormat } from '../fetch.service';

export class FetchDatasetDto {
  @ApiPropertyOptional({
    description:
      'Number of SteamSpy pages to download (1000 games each, one request per STEAMSPY_MIN_INTERVAL_MS, ' +
      '60 s by default). Capped by FETCH_MAX_PAGES; stops early at the end of the catalog. ' +
      'Default: FETCH_DEFAULT_PAGES.',
    minimum: 1,
    maximum: 1000,
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pages?: number;

  @ApiPropertyOptional({ description: 'First SteamSpy page (0-based)', minimum: 0, default: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  startPage?: number;

  @ApiPropertyOptional({ enum: ['json', 'xlsx', 'both'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'xlsx', 'both'])
  format: ExportFormat = 'json';

  @ApiPropertyOptional({ description: 'Base file name without extension', example: 'games-sample' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/, { message: 'fileName may contain letters, digits, - and _' })
  fileName?: string;

  @ApiPropertyOptional({
    description:
      'Wait for completion and return the result (otherwise 202 + job). Each page after the first adds ' +
      'about a minute, so prefer polling GET /datasets/jobs/:id.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  wait: boolean = false;
}

export class IngestFileDto {
  @ApiProperty({ description: 'Name of a file in the exports directory', example: 'games-sample.json' })
  @IsString()
  fileName!: string;
}

export class UploadDatasetDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '.json (array or {data:[...]}) or .xlsx (header row)',
  })
  file!: unknown;
}
