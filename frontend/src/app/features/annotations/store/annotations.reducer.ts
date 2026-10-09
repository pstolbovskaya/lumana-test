import { EntityAdapter, EntityState, createEntityAdapter } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import { AnnotationsActions } from './annotations.actions';
import { Polygon } from './polygon.model';

export interface AnnotationsState extends EntityState<Polygon> {
  idsByGame: Record<string, string[]>;
}

export const polygonAdapter: EntityAdapter<Polygon> = createEntityAdapter<Polygon>({
  sortComparer: (a, b) => a.createdAt - b.createdAt,
});

export const initialAnnotationsState: AnnotationsState = polygonAdapter.getInitialState({
  idsByGame: {},
});

export const annotationsFeature = createFeature({
  name: 'annotations',
  reducer: createReducer(
    initialAnnotationsState,
    on(AnnotationsActions.polygonAdded, (state, { polygon }) => {
      if (polygon.points.length < 3) return state;
      const next = polygonAdapter.addOne(polygon, state);
      const ids = state.idsByGame[polygon.gameId] ?? [];
      return { ...next, idsByGame: { ...state.idsByGame, [polygon.gameId]: [...ids, polygon.id] } };
    }),
    on(AnnotationsActions.polygonPointsChanged, (state, { id, points, at }) =>
      polygonAdapter.updateOne({ id, changes: { points, updatedAt: at } }, state),
    ),
    on(AnnotationsActions.polygonRemoved, (state, { id }) => {
      const polygon = state.entities[id];
      if (!polygon) return state;
      const next = polygonAdapter.removeOne(id, state);
      const remaining = (state.idsByGame[polygon.gameId] ?? []).filter((x) => x !== id);
      const { [polygon.gameId]: _removed, ...rest } = state.idsByGame;
      return {
        ...next,
        idsByGame: remaining.length ? { ...rest, [polygon.gameId]: remaining } : rest,
      };
    }),
    on(AnnotationsActions.gamePolygonsCleared, (state, { gameId }) => {
      const ids = state.idsByGame[gameId];
      if (!ids?.length) return state;
      const next = polygonAdapter.removeMany(ids, state);
      const { [gameId]: _removed, ...rest } = state.idsByGame;
      return { ...next, idsByGame: rest };
    }),
  ),
  extraSelectors: ({ selectAnnotationsState }) => polygonAdapter.getSelectors(selectAnnotationsState),
});

export function selectPolygonsForGame(gameId: string) {
  return createSelector(
    annotationsFeature.selectIdsByGame,
    annotationsFeature.selectEntities,
    (index, entities): Polygon[] =>
      (index[gameId] ?? []).map((id) => entities[id]).filter((p): p is Polygon => !!p),
  );
}
