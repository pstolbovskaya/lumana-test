import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { GameDocument } from '../game.types';

export class GameResponseDto {
  @ApiProperty({ description: 'Mongo document id' }) id!: string;
  @ApiProperty({ description: 'Steam app id (natural key)', example: 730 }) appid!: number;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) developer!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) publisher!: string | null;
  @ApiProperty({ description: 'Positive reviews' }) positive!: number;
  @ApiProperty({ description: 'Negative reviews' }) negative!: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'positive / (positive + negative) in percent, one decimal; null without reviews',
  })
  reviewScore!: number | null;
  @ApiProperty({ description: 'Lower bound of the SteamSpy owners estimate' }) ownersMin!: number;
  @ApiProperty({ description: 'Upper bound of the SteamSpy owners estimate' }) ownersMax!: number;
  @ApiProperty({ description: 'Average playtime, minutes' }) averagePlaytime!: number;
  @ApiProperty({ description: 'Median playtime, minutes' }) medianPlaytime!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Current price, US cents' })
  priceCents!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Original price, US cents' })
  initialPriceCents!: number | null;
  @ApiProperty() discountPercent!: number;
  @ApiProperty({ description: 'Peak concurrent users yesterday' }) ccu!: number;
  @ApiProperty({ example: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg' })
  headerImageUrl!: string;
  @ApiProperty({ example: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_hero.jpg' })
  heroImageUrl!: string;
  @ApiProperty() updatedAt!: Date;

  static from(doc: GameDocument): GameResponseDto {
    return {
      id: doc._id.toHexString(),
      appid: doc.appid,
      name: doc.name,
      developer: doc.developer,
      publisher: doc.publisher,
      positive: doc.positive,
      negative: doc.negative,
      reviewScore: doc.reviewScore,
      ownersMin: doc.ownersMin,
      ownersMax: doc.ownersMax,
      averagePlaytime: doc.averagePlaytime,
      medianPlaytime: doc.medianPlaytime,
      priceCents: doc.priceCents,
      initialPriceCents: doc.initialPriceCents,
      discountPercent: doc.discountPercent,
      ccu: doc.ccu,
      headerImageUrl: doc.headerImageUrl,
      heroImageUrl: doc.heroImageUrl,
      updatedAt: doc.updatedAt,
    };
  }
}

export class GamePageResponseDto {
  @ApiProperty({ type: [GameResponseDto] }) items!: GameResponseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Cursor for the next page, null when exhausted' })
  nextCursor!: string | null;
  @ApiProperty() limit!: number;
}
