import { CollectionViewer, DataSource, ListRange } from '@angular/cdk/collections';
import { Store } from '@ngrx/store';
import { Observable, Subscription, asapScheduler, combineLatest, distinctUntilChanged, filter, map, observeOn } from 'rxjs';
import { Game } from '../../core/api/game.models';
import { SearchActions } from './store/search.actions';
import { PagingState, searchFeature } from './store/search.reducer';

export const PREFETCH_THRESHOLD = 10;

export function pageKeyFor(range: ListRange, s: PagingState, threshold = PREFETCH_THRESHOLD): string | null {
  const due = s.ready && s.hasMore && !s.loading && s.loadedCount > 0 && range.end >= s.loadedCount - threshold;
  return due ? `${s.searchId}|${s.lastLoadedPage + 1}` : null;
}

export class GamesDataSource extends DataSource<Game> {
  private subscription: Subscription | null = null;

  constructor(
    private readonly store: Store,
    private readonly threshold = PREFETCH_THRESHOLD,
  ) {
    super();
  }

  connect(collectionViewer: CollectionViewer): Observable<readonly Game[]> {
    this.subscription?.unsubscribe();
    this.subscription = combineLatest([collectionViewer.viewChange, this.store.select(searchFeature.selectPaging)])
      .pipe(
        map(([range, paging]) => pageKeyFor(range, paging, this.threshold)),
        filter((key): key is string => key !== null),
        distinctUntilChanged(),
        observeOn(asapScheduler),
      )
      .subscribe(() => this.store.dispatch(SearchActions.nextPageRequested()));
    return this.store.select(searchFeature.selectAllGames);
  }

  disconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
