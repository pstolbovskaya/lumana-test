import { EntityAdapter, EntityState, createEntityAdapter } from '@ngrx/entity';
import { createFeature, createReducer, on } from '@ngrx/store';
import { QueryHistoryActions } from './query-history.actions';
import { QueryHistoryEntry } from './query-history.models';
import { normalizeQuery } from './query-text';

export const MAX_HISTORY_ENTRIES = 200;
export const PREFIX_COLLAPSE_WINDOW_MS = 20_000;

export type QueryHistoryState = EntityState<QueryHistoryEntry>;

export const queryHistoryAdapter: EntityAdapter<QueryHistoryEntry> =
  createEntityAdapter<QueryHistoryEntry>({
    selectId: (e: QueryHistoryEntry) => e.id,
    sortComparer: (a: QueryHistoryEntry, b: QueryHistoryEntry) => b.lastUsed - a.lastUsed || a.id.localeCompare(b.id),
  });

export const initialQueryHistoryState: QueryHistoryState = queryHistoryAdapter.getInitialState();

function recordQuery(
  state: QueryHistoryState,
  rawQuery: string,
  resultCount: number,
  at: number,
): QueryHistoryState {
  const id = normalizeQuery(rawQuery);
  if (!id || resultCount <= 0) {
    return state;
  }

  const transientPrefixes = Object.values(state.entities)
    .filter(
      (e): e is QueryHistoryEntry =>
        !!e &&
        e.id !== id &&
        id.startsWith(e.id) &&
        e.hits === 1 &&
        at - e.lastUsed <= PREFIX_COLLAPSE_WINDOW_MS,
    )
    .map((e) => e.id);
  let next = queryHistoryAdapter.removeMany(transientPrefixes, state);

  const isBackspacePrefix = Object.values(next.entities).some(
    (e) => !!e && e.id !== id && e.id.startsWith(id) && at - e.lastUsed <= PREFIX_COLLAPSE_WINDOW_MS / 2,
  );
  const existing = next.entities[id];
  if (isBackspacePrefix && !existing) {
    return next;
  }

  next = queryHistoryAdapter.upsertOne(
    {
      id,
      hits: (existing?.hits ?? 0) + 1,
      resultCount,
      firstUsed: existing?.firstUsed ?? at,
      lastUsed: at,
    },
    next,
  );

  if (next.ids.length > MAX_HISTORY_ENTRIES) {
    const overflow = (next.ids as string[]).slice(MAX_HISTORY_ENTRIES);
    next = queryHistoryAdapter.removeMany(overflow, next);
  }
  return next;
}

export const queryHistoryFeature = createFeature({
  name: 'queryHistory',
  reducer: createReducer(
    initialQueryHistoryState,
    on(QueryHistoryActions.queryRecorded, (state, { query, resultCount, at }) =>
      recordQuery(state, query, resultCount, at),
    ),
    on(QueryHistoryActions.queryRemoved, (state, { query }) =>
      queryHistoryAdapter.removeOne(normalizeQuery(query), state),
    ),
    on(QueryHistoryActions.historyCleared, (state) => queryHistoryAdapter.removeAll(state)),
  ),
  extraSelectors: ({ selectQueryHistoryState }) => queryHistoryAdapter.getSelectors(selectQueryHistoryState),
});
