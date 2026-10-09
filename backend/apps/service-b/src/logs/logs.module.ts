import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { LogsController } from './logs.controller';
import { LogsRepository } from './logs.repository';

@Module({
  controllers: [LogsController, EventsController],
  providers: [LogsRepository],
  exports: [LogsRepository],
})
export class LogsModule {}
