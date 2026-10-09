import { SetMetadata } from '@nestjs/common';

export const TRACK_ACTION_KEY = 'track:action';
export const SKIP_TRACKING_KEY = 'track:skip';

export const TrackAction = (action: string): MethodDecorator & ClassDecorator =>
  SetMetadata(TRACK_ACTION_KEY, action);

export const SkipTracking = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_TRACKING_KEY, true);
