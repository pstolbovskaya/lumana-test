import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TrackAction } from '@app/common';
import { EventLogDto, EventLogPageDto, LogFilterQueryDto, LogQueryDto } from './dto/logs.dto';
import { LogsRepository } from './logs.repository';
import type { LogStats } from './logs.repository';

@ApiTags('logs')
@Controller('logs')
export class LogsController {
  constructor(private readonly repo: LogsRepository) {}

  @Get()
  @TrackAction('logs.query')
  @ApiOperation({ summary: 'Query stored events (filters + cursor pagination by timestamp)' })
  @ApiOkResponse({ type: EventLogPageDto })
  async find(@Query() q: LogQueryDto): Promise<EventLogPageDto> {
    const page = await this.repo.find(q);
    return { ...page, items: page.items.map((d) => EventLogDto.from(d)) };
  }

  @Get('stats')
  @TrackAction('logs.stats')
  @ApiOperation({
    summary: 'Aggregated statistics (per action / status / service / type, latency avg & p95)',
  })
  stats(@Query() q: LogFilterQueryDto): Promise<LogStats> {
    return this.repo.stats(q);
  }

  @Get(':id')
  @TrackAction('logs.get')
  @ApiOperation({ summary: 'Get a single event by id' })
  @ApiOkResponse({ type: EventLogDto })
  @ApiNotFoundResponse()
  async get(@Param('id') id: string): Promise<EventLogDto> {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException(`Event ${id} not found`);
    return EventLogDto.from(doc);
  }
}
