import {
  bounds,
  centroid,
  denormalize,
  normalize,
  pointInPolygon,
  rotate,
  rotateNormalized,
  signedArea,
  translateClamped,
} from './geometry';

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('geometry', () => {
  it('computes area and centroid of a square', () => {
    close(Math.abs(signedArea(square)), 4);
    const c = centroid(square);
    close(c.x, 1);
    close(c.y, 1);
  });

  it('computes the area centroid (not vertex average) of an irregular polygon', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    const c = centroid(l);
    close(c.x, 9.5 / 7);
    close(c.y, 9.5 / 7);
  });

  it('falls back to vertex average for degenerate polygons', () => {
    const c = centroid([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
    close(c.x, 1);
    close(c.y, 1);
  });

  it('hit-tests points with ray casting', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false);
    const concave = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 2, y: 1 },
      { x: 0, y: 4 },
    ];
    expect(pointInPolygon({ x: 2, y: 3 }, concave)).toBe(false);
    expect(pointInPolygon({ x: 2, y: 0.5 }, concave)).toBe(true);
  });

  it('rotates around the centroid preserving it', () => {
    const r = rotate(square, Math.PI / 2);
    const c = centroid(r);
    close(c.x, 1);
    close(c.y, 1);
    close(r[0].x, 2);
    close(r[0].y, 0);
  });

  it('normalize/denormalize round-trips', () => {
    const size = { width: 800, height: 400 };
    const px = [{ x: 200, y: 100 }];
    const n = normalize(px, size);
    expect(n).toEqual([{ x: 0.25, y: 0.25 }]);
    expect(denormalize(n, { width: 400, height: 200 })).toEqual([{ x: 100, y: 50 }]);
  });

  it('rotates normalised points in aspect-correct pixel space', () => {
    const size = { width: 200, height: 100 };
    const seg = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ];
    const r = denormalize(rotateNormalized(seg, Math.PI / 2, size), size);
    close(Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y), 100);
    close(r[0].x, r[1].x);
  });

  it('clamps translation to the unit square', () => {
    const poly = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ];
    const b = bounds(translateClamped(poly, 1, -1));
    close(b.maxX, 1);
    close(b.minY, 0);
  });
});
