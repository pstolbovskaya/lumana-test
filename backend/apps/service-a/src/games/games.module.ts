import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesRepository } from './games.repository';

@Module({
  controllers: [GamesController],
  providers: [GamesRepository],
  exports: [GamesRepository],
})
export class GamesModule {}
