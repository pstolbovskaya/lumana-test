import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  concat,
  debounceTime,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  switchMap,
  takeUntil,
  withLatestFrom,
} from 'rxjs';
import { CheapSharkApiService } from '../../../core/api/cheapshark-api.service';
import { SEARCH_PAGE_SIZE } from '../../../core/api/cheapshark-query';
import { toAppHttpError } from '../../../core/http/app-http-error';
import { SearchPage } from '../../../core/api/game.models';
import { QueryHistoryActions } from './query-history.actions';
import { isSearchable, normalizeQuery } from './query-text';
import { SearchActions } from './search.actions';
import { searchFeature } from './search.reducer';

export const SEARCH_DEBOUNCE_MS = 300;

export function estimateResultCount(page: SearchPage): number {
  return page.totalPages > 1 ? page.totalPages * SEARCH_PAGE_SIZE : new Set(page.items.map((g) => g.id)).size;
}

@Injectable()
export class SearchEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(CheapSharkApiService);
  private readonly store = inject(Store);

  readonly search$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SearchActions.queryChanged),
      map(({ query }) => normalizeQuery(query)),
      debounceTime(SEARCH_DEBOUNCE_MS),
      filter((query) => query.length === 0 || isSearchable(query)),
      distinctUntilChanged(),
      switchMap((query) => (query ? this.runSearch(query) : of(SearchActions.searchCleared()))),
    ),
  );

  readonly retry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SearchActions.retryRequested),
      withLatestFrom(this.store.select(searchFeature.selectQuery)),
      filter(([, query]) => !!query),
      switchMap(([, query]) => this.runSearch(query)),
    ),
  );

  readonly nextPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SearchActions.nextPageRequested),
      withLatestFrom(this.store.select(searchFeature.selectSearchState)),
      filter(
        ([, s]) =>
          s.status === 'success' && s.loadingPage === null && s.lastLoadedPage < s.totalPages,
      ),
      exhaustMap(([, s]) => {
        const page = s.lastLoadedPage + 1;
        return concat(
          of(SearchActions.pageLoadStarted({ query: s.query, page })),
          this.api.search(s.query, page).pipe(
            map((result) => SearchActions.pageLoaded({ page: result })),
            catchError((error: unknown) =>
              of(SearchActions.pageLoadFailed({ query: s.query, page, error: toAppHttpError(error) })),
            ),
            takeUntil(this.actions$.pipe(ofType(SearchActions.searchStarted, SearchActions.searchCleared))),
          ),
        );
      }),
    ),
  );

  readonly recordQuery$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SearchActions.searchSucceeded),
      filter(({ page }) => page.items.length > 0),
      map(({ page }) =>
        QueryHistoryActions.queryRecorded({
          query: page.query,
          resultCount: estimateResultCount(page),
          at: Date.now(),
        }),
      ),
    ),
  );

  private runSearch(query: string) {
    return concat(
      of(SearchActions.searchStarted({ query })),
      this.api.search(query, 1).pipe(
        map((page) => SearchActions.searchSucceeded({ page })),
        catchError((error: unknown) =>
          of(SearchActions.searchFailed({ query, error: toAppHttpError(error) })),
        ),
      ),
    );
  }
}
