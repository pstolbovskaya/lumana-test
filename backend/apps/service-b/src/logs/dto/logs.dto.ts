import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TimeQueryParam } from '@app/common';
import type { SortOrder } from '@app/common';
import type { EventLogDocument } from '../log.types';

export class LogFilterQueryDto {
  @ApiPropertyOptional({
    description: 'From (inclusive), ISO-8601 or epoch ms',
    example: '2026-01-01T00:00:00Z',
  })
  @TimeQueryParam()
  from?: Date;

  @ApiPropertyOptional({ description: 'To (inclusive), ISO-8601 or epoch ms' })
  @TimeQueryParam()
  to?: Date;

  @ApiPropertyOptional({ description: 'Event type', example: 'http.request' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ example: 'service-a' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  service?: string;

  @ApiPropertyOptional({ description: 'Logical action', example: 'games.search' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  action?: string;

  @ApiPropertyOptional({ example: 'GET' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;
}

export class LogQueryDto extends LogFilterQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'Order by timestamp' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: SortOrder = 'desc';
}

export class EventLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() service!: string;
  @ApiProperty() action!: string;
  @ApiProperty() method!: string;
  @ApiProperty() path!: string;
  @ApiProperty() statusCode!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty() timestamp!: Date;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Record<string, unknown>;
  @ApiProperty() receivedAt!: Date;

  static from(doc: EventLogDocument): EventLogDto {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }
}

export class EventLogPageDto {
  @ApiProperty({ type: [EventLogDto] }) items!: EventLogDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() limit!: number;
}
