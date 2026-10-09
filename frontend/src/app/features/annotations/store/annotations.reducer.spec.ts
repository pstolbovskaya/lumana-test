import { AnnotationsActions } from './annotations.actions';
import { annotationsFeature, initialAnnotationsState, selectPolygonsForGame } from './annotations.reducer';
import { Polygon } from './polygon.model';

const tri = (id: string, gameId: string, createdAt = 0): Polygon => ({
  id,
  gameId,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.3, y: 0.4 },
  ],
  color: '#ff4081',
  createdAt,
  updatedAt: createdAt,
});

const reducer = annotationsFeature.reducer;

describe('annotations reducer', () => {
  let state = initialAnnotationsState;
  state = reducer(state, AnnotationsActions.polygonAdded({ polygon: tri('a', 'steam:1', 1) }));
  state = reducer(state, AnnotationsActions.polygonAdded({ polygon: tri('b', 'steam:1', 2) }));
  state = reducer(state, AnnotationsActions.polygonAdded({ polygon: tri('c', 'cs:2', 3) }));

  it('groups polygons by game', () => {
    expect(selectPolygonsForGame('steam:1')({ annotations: state }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(selectPolygonsForGame('cs:2')({ annotations: state }).map((p) => p.id)).toEqual(['c']);
  });

  it('rejects polygons with fewer than 3 vertices', () => {
    const bad = { ...tri('x', 'steam:1'), points: [{ x: 0, y: 0 }] };
    expect(reducer(state, AnnotationsActions.polygonAdded({ polygon: bad }))).toBe(state);
  });

  it('updates points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const next = reducer(state, AnnotationsActions.polygonPointsChanged({ id: 'a', points, at: 99 }));
    expect(next.entities['a']?.points).toEqual(points);
    expect(next.entities['a']?.updatedAt).toBe(99);
  });

  it('removes a polygon and keeps the index consistent', () => {
    let next = reducer(state, AnnotationsActions.polygonRemoved({ id: 'c' }));
    expect(next.idsByGame['cs:2']).toBeUndefined();
    next = reducer(next, AnnotationsActions.polygonRemoved({ id: 'a' }));
    expect(next.idsByGame['steam:1']).toEqual(['b']);
  });

  it('clears all polygons of one game only', () => {
    const next = reducer(state, AnnotationsActions.gamePolygonsCleared({ gameId: 'steam:1' }));
    expect(next.ids).toEqual(['c']);
    expect(next.idsByGame).toEqual({ 'cs:2': ['c'] });
  });
});
