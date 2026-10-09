import { createActionGroup, props } from '@ngrx/store';
import { Point } from '../geometry/geometry';
import { Polygon } from './polygon.model';

export const AnnotationsActions = createActionGroup({
  source: 'Annotations',
  events: {
    'Polygon Added': props<{ polygon: Polygon }>(),
    'Polygon Points Changed': props<{ id: string; points: Point[]; at: number }>(),
    'Polygon Removed': props<{ id: string }>(),
    'Game Polygons Cleared': props<{ gameId: string }>(),
  },
});
