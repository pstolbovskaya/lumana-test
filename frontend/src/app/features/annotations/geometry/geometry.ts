export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

export function centroid(points: readonly Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const a = signedArea(points);
  if (Math.abs(a) < 1e-12) {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function translate(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function rotate(points: readonly Point[], angle: number, origin: Point = centroid(points)): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
  });
}

export function bounds(points: readonly Point[]): Bounds {
  return points.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      minY: Math.min(b.minY, p.y),
      maxX: Math.max(b.maxX, p.x),
      maxY: Math.max(b.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function normalize(points: readonly Point[], size: Size): Point[] {
  return points.map((p) => ({ x: p.x / size.width, y: p.y / size.height }));
}

export function denormalize(points: readonly Point[], size: Size): Point[] {
  return points.map((p) => ({ x: p.x * size.width, y: p.y * size.height }));
}

export function rotateNormalized(points: readonly Point[], angle: number, size: Size): Point[] {
  const px = denormalize(points, size);
  return normalize(rotate(px, angle), size);
}

export function translateClamped(points: readonly Point[], dx: number, dy: number): Point[] {
  const b = bounds(points);
  const cdx = Math.min(Math.max(dx, -b.minX), 1 - b.maxX);
  const cdy = Math.min(Math.max(dy, -b.minY), 1 - b.maxY);
  return translate(points, cdx, cdy);
}

export function angleTo(origin: Point, p: Point): number {
  return Math.atan2(p.y - origin.y, p.x - origin.x);
}
