import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { API_EVENT_PATTERN, isApiEvent } from '@app/common';
import { LogsRepository } from './logs.repository';

@Controller()
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly repo: LogsRepository) {}

  @EventPattern(API_EVENT_PATTERN)
  async handleApiEvent(@Payload() payload: unknown): Promise<void> {
    if (!isApiEvent(payload)) {
      this.logger.warn(`Dropping malformed event: ${JSON.stringify(payload)?.slice(0, 500)}`);
      return;
    }
    try {
      const stored = await this.repo.insertEvent(payload);
      this.logger.debug(
        `${stored ? 'Stored' : 'Duplicate'} event ${payload.id} (${payload.action} ${payload.statusCode})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to store event ${payload.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
