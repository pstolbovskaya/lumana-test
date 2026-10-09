import { EntityAdapter, EntityState, createEntityAdapter } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import { isBetterDeal } from '../../../core/api/game-mapping';
import { Game, SearchPage } from '../../../core/api/game.models';
import { SearchActions } from './search.actions';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface SearchState extends EntityState<Game> {
  input: string;
  query: string;
  searchId: number;
  status: SearchStatus;
  error: string | null;
  dealCount: number;
  totalPages: number;
  lastLoadedPage: number;
  loadingPage: number | null;
  pageError: string | null;
}

export const gamesAdapter: EntityAdapter<Game> = createEntityAdapter<Game>({
  selectId: (g: Game) => g.id,
  sortComparer: false,
});

export const initialSearchState: SearchState = gamesAdapter.getInitialState({
  input: '',
  query: '',
  searchId: 0,
  status: 'idle' as SearchStatus,
  error: null,
  dealCount: 0,
  totalPages: 0,
  lastLoadedPage: 0,
  loadingPage: null,
  pageError: null,
});

function addBestDeals(state: SearchState, rows: readonly Game[]): SearchState {
  const bestInPage = new Map<string, Game>();
  for (const game of rows) {
    const current = bestInPage.get(game.id);
    if (!current || isBetterDeal(game, current)) bestInPage.set(game.id, game);
  }
  const added: Game[] = [];
  const improved: Game[] = [];
  for (const game of bestInPage.values()) {
    const existing = state.entities[game.id];
    if (!existing) added.push(game);
    else if (isBetterDeal(game, existing)) improved.push(game);
  }
  return gamesAdapter.upsertMany(improved, gamesAdapter.addMany(added, state));
}

const isCurrent = (state: SearchState, page: SearchPage | { query: string }) =>
  page.query === state.query;

export const searchFeature = createFeature({
  name: 'search',
  reducer: createReducer(
    initialSearchState,
    on(SearchActions.queryChanged, (state, { query }) => ({ ...state, input: query })),
    on(SearchActions.searchStarted, (state, { query }) =>
      gamesAdapter.removeAll({
        ...state,
        query,
        searchId: state.searchId + 1,
        status: 'loading' as const,
        error: null,
        pageError: null,
        loadingPage: null,
        dealCount: 0,
        totalPages: 0,
        lastLoadedPage: 0,
      }),
    ),
    on(SearchActions.searchSucceeded, (state, { page }) =>
      isCurrent(state, page)
        ? addBestDeals(
            {
              ...state,
              status: 'success' as const,
              dealCount: page.items.length,
              totalPages: page.totalPages,
              lastLoadedPage: page.page,
            },
            page.items,
          )
        : state,
    ),
    on(SearchActions.searchFailed, (state, { query, error }) =>
      query === state.query ? { ...state, status: 'error' as const, error: error.message } : state,
    ),
    on(SearchActions.searchCleared, (state) => ({ ...initialSearchState, input: state.input })),
    on(SearchActions.pageLoadStarted, (state, { query, page }) =>
      query === state.query ? { ...state, loadingPage: page, pageError: null } : state,
    ),
    on(SearchActions.pageLoaded, (state, { page }) =>
      isCurrent(state, page) && page.page === state.lastLoadedPage + 1
        ? addBestDeals(
            {
              ...state,
              dealCount: state.dealCount + page.items.length,
              lastLoadedPage: page.page,
              totalPages: page.totalPages,
              loadingPage: null,
            },
            page.items,
          )
        : state,
    ),
    on(SearchActions.pageLoadFailed, (state, { query, error }) =>
      query === state.query ? { ...state, loadingPage: null, pageError: error.message } : state,
    ),
  ),
  extraSelectors: ({ selectSearchState, selectLastLoadedPage, selectTotalPages, selectStatus, selectLoadingPage, selectQuery, selectSearchId }) => {
    const { selectAll, selectEntities, selectTotal } = gamesAdapter.getSelectors(selectSearchState);
    const selectHasMore = createSelector(
      selectLastLoadedPage,
      selectTotalPages,
      (last, totalPages) => last > 0 && last < totalPages,
    );
    const selectIsPageLoading = createSelector(selectLoadingPage, (p) => p !== null);
    return {
      selectAllGames: selectAll,
      selectGameEntities: selectEntities,
      selectGameCount: selectTotal,
      selectHasMore,
      selectIsInitialLoading: createSelector(selectStatus, (s) => s === 'loading'),
      selectIsPageLoading,
      selectPaging: createSelector(
        selectQuery,
        selectSearchId,
        selectStatus,
        selectLastLoadedPage,
        selectIsPageLoading,
        selectHasMore,
        selectTotal,
        (query, searchId, status, lastLoadedPage, loading, hasMore, loadedCount): PagingState => ({
          query,
          searchId,
          ready: status === 'success',
          lastLoadedPage,
          loading,
          hasMore,
          loadedCount,
        }),
      ),
    };
  },
});

export interface PagingState {
  query: string;
  searchId: number;
  ready: boolean;
  lastLoadedPage: number;
  loading: boolean;
  hasMore: boolean;
  loadedCount: number;
}
