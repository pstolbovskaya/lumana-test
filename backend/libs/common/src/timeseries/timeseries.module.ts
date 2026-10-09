import { Module } from '@nestjs/common';
import { TimeSeriesService } from './timeseries.service';

@Module({
  providers: [TimeSeriesService],
  exports: [TimeSeriesService],
})
export class TimeSeriesModule {}
