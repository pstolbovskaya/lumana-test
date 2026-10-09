import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TrackAction } from '@app/common';
import { GamesRepository } from './games.repository';
import { GamePageResponseDto, GameResponseDto } from './dto/game.response';
import { SearchGamesQueryDto } from './dto/search-games.dto';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly repo: GamesRepository) {}

  @Get()
  @TrackAction('games.search')
  @ApiOperation({
    summary: 'Search games',
    description:
      'Full-text + filters with keyset (cursor) pagination. Pass `nextCursor` from the previous page as `cursor` ' +
      '(keep the same sortBy/order). Deep pages cost the same as the first one (no skip).',
  })
  @ApiOkResponse({ type: GamePageResponseDto })
  async search(@Query() query: SearchGamesQueryDto): Promise<GamePageResponseDto> {
    const page = await this.repo.search(query);
    return { ...page, items: page.items.map((d) => GameResponseDto.from(d)) };
  }

  @Get(':appid')
  @TrackAction('games.get')
  @ApiOperation({ summary: 'Get a game by its Steam app id' })
  @ApiOkResponse({ type: GameResponseDto })
  @ApiNotFoundResponse()
  async get(@Param('appid', ParseIntPipe) appid: number): Promise<GameResponseDto> {
    const doc = await this.repo.findByAppid(appid);
    if (!doc) throw new NotFoundException(`Game ${appid} not found`);
    return GameResponseDto.from(doc);
  }
}
