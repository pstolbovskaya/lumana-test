import { Point } from '../geometry/geometry';

export interface Polygon {
  id: string;
  gameId: string;
  points: Point[];
  color: string;
  createdAt: number;
  updatedAt: number;
}

export const POLYGON_COLORS = ['#ff4081', '#00e5ff', '#ffd740', '#69f0ae', '#b388ff', '#ff6e40'];
