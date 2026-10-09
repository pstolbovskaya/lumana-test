import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CursorPaginationQueryDto } from '@app/common';
import type { SortOrder } from '@app/common';
import { GAME_SORT_FIELDS } from '../games.repository';
import type { GameSortField } from '../games.repository';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : value;
};

export class SearchGamesQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Full-text search over name (weight 10), developer (4), publisher (2)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Developer, exact match (case-insensitive)', example: 'Valve' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  developer?: string;

  @ApiPropertyOptional({ description: 'Publisher, exact match (case-insensitive)', example: 'Valve' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  publisher?: string;

  @ApiPropertyOptional({ description: 'Minimum current price in US cents (inclusive)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @ApiPropertyOptional({ description: 'Maximum current price in US cents (inclusive)', example: 1999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  @ApiPropertyOptional({ description: 'Minimum review score in percent (0-100)', example: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  minReviewScore?: number;

  @ApiPropertyOptional({ description: 'Only free games (priceCents = 0); overrides the price range' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  freeOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum owners: lower bound of the SteamSpy owners range (ownersMin >= value)',
    example: 1000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOwners?: number;

  @ApiPropertyOptional({ enum: GAME_SORT_FIELDS, default: '_id' })
  @IsOptional()
  @IsIn(GAME_SORT_FIELDS)
  sortBy: GameSortField = '_id';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Default: desc for ccu, positive and reviewScore; asc otherwise',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;
}
