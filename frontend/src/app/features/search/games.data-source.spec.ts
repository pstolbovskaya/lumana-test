import { CollectionViewer, ListRange } from '@angular/cdk/collections';
import { TestBed } from '@angular/core/testing';
import { provideEffects } from '@ngrx/effects';
import { Action, Store, provideStore } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { CheapSharkApiService } from '../../core/api/cheapshark-api.service';
import { toGame } from '../../core/api/game-mapping';
import { dealDto } from '../../core/api/game.fixtures';
import { Game, SearchPage } from '../../core/api/game.models';
import { GamesDataSource, pageKeyFor } from './games.data-source';
import { SearchActions } from './store/search.actions';
import { SearchEffects } from './store/search.effects';
import { PagingState, SearchState, gamesAdapter, initialSearchState, searchFeature } from './store/search.reducer';

const game = (n: number): Game => ({ ...toGame(dealDto()), id: `steam:${n}`, title: `Game ${n}` });
const games = (from: number, count: number) => Array.from({ length: count }, (_, i) => game(from + i));

function searchState(count: number, over: Partial<SearchState> = {}): { search: SearchState } {
  const base: SearchState = {
    ...initialSearchState,
    query: 'star',
    status: 'success',
    lastLoadedPage: 1,
    totalPages: 5,
    ...over,
  };
  return { search: gamesAdapter.setAll(games(0, count), base) };
}

describe('GamesDataSource', () => {
  let store: MockStore;
  let viewChange: Subject<ListRange>;
  let viewer: CollectionViewer;
  let dataSource: GamesDataSource;
  let dispatched: Action[];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideMockStore({ initialState: searchState(30) })] });
    store = TestBed.inject(MockStore);
    dispatched = [];
    store.scannedActions$.subscribe((a) => dispatched.push(a));
    viewChange = new Subject<ListRange>();
    viewer = { viewChange };
    dataSource = new GamesDataSource(store, 10);
  });

  afterEach(() => dataSource.disconnect());

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const nextPageCount = () => dispatched.filter((a) => a.type === SearchActions.nextPageRequested.type).length;

  it('streams the entity collection (selectAllGames) as data', async () => {
    let data: readonly Game[] = [];
    dataSource.connect(viewer).subscribe((d) => (data = d));
    expect(data.map((g) => g.id).slice(0, 3)).toEqual(['steam:0', 'steam:1', 'steam:2']);
    expect(data).toHaveLength(30);
  });

  it('dispatches Next Page Requested only when the range nears the loaded end', async () => {
    dataSource.connect(viewer).subscribe();
    viewChange.next({ start: 0, end: 12 });
    await flush();
    expect(nextPageCount()).toBe(0);
    viewChange.next({ start: 8, end: 20 });
    await flush();
    expect(nextPageCount()).toBe(1);
  });

  it('does not dispatch while a page is loading, before success, or when there are no more pages', async () => {
    dataSource.connect(viewer).subscribe();
    store.setState(searchState(30, { loadingPage: 2 }));
    viewChange.next({ start: 18, end: 30 });
    store.setState(searchState(30, { lastLoadedPage: 5, totalPages: 5 }));
    viewChange.next({ start: 18, end: 30 });
    store.setState(searchState(30, { status: 'loading' }));
    viewChange.next({ start: 18, end: 30 });
    await flush();
    expect(nextPageCount()).toBe(0);
  });

  it('does not dispatch twice for the same page (scrolling, loading flag toggling, a failed page)', async () => {
    dataSource.connect(viewer).subscribe();
    viewChange.next({ start: 18, end: 25 });
    viewChange.next({ start: 20, end: 28 });
    viewChange.next({ start: 22, end: 30 });
    await flush();
    expect(nextPageCount()).toBe(1);
    store.setState(searchState(30, { loadingPage: 2 }));
    store.setState(searchState(30, { pageError: 'boom' }));
    viewChange.next({ start: 22, end: 30 });
    await flush();
    expect(nextPageCount()).toBe(1);
  });

  it('continues after a page that added only duplicates (same length, cursor advanced), without scrolling', async () => {
    dataSource.connect(viewer).subscribe();
    viewChange.next({ start: 18, end: 30 });
    await flush();
    expect(nextPageCount()).toBe(1);
    store.setState(searchState(30, { loadingPage: 2 }));
    store.setState(searchState(30, { lastLoadedPage: 2 }));
    await flush();
    expect(nextPageCount()).toBe(2);
  });

  it('re-evaluates after a page with new games when the range is still near the end', async () => {
    dataSource.connect(viewer).subscribe();
    viewChange.next({ start: 18, end: 30 });
    store.setState(searchState(35, { lastLoadedPage: 2 }));
    await flush();
    expect(nextPageCount()).toBe(2);
    store.setState(searchState(90, { lastLoadedPage: 3 }));
    await flush();
    expect(nextPageCount()).toBe(2);
  });

  it('stops listening on disconnect', async () => {
    dataSource.connect(viewer).subscribe();
    dataSource.disconnect();
    viewChange.next({ start: 18, end: 30 });
    await flush();
    expect(nextPageCount()).toBe(0);
    expect(viewChange.observed).toBe(false);
  });
});

describe('pageKeyFor', () => {
  const paging = (over: Partial<PagingState> = {}): PagingState => ({
    query: 'star',
    searchId: 1,
    ready: true,
    lastLoadedPage: 1,
    loading: false,
    hasMore: true,
    loadedCount: 30,
    ...over,
  });

  it('names the next page by number', async () => {
    expect(pageKeyFor({ start: 0, end: 19 }, paging())).toBeNull();
    expect(pageKeyFor({ start: 0, end: 20 }, paging())).toBe('1|2');
    expect(pageKeyFor({ start: 0, end: 20 }, paging({ lastLoadedPage: 2 }))).toBe('1|3');
  });

  it('gives a repeated search for the same text its own keys', async () => {
    const first = pageKeyFor({ start: 0, end: 20 }, paging());
    const repeated = pageKeyFor({ start: 0, end: 20 }, paging({ searchId: 2 }));
    expect(repeated).not.toBe(first);
  });

  it('is null for an empty list', async () => {
    expect(pageKeyFor({ start: 0, end: 0 }, paging({ loadedCount: 0 }))).toBeNull();
  });
});

describe('GamesDataSource + real store and SearchEffects (integration)', () => {
  it('keeps loading page after page, also after a duplicates-only page, each page exactly once', async () => {
    const calls: { page: number; response: Subject<SearchPage> }[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideStore({ search: searchFeature.reducer }),
        provideEffects(SearchEffects),
        {
          provide: CheapSharkApiService,
          useValue: {
            search: (_q: string, page: number) => {
              const response = new Subject<SearchPage>();
              calls.push({ page, response });
              return response;
            },
          },
        },
      ],
    });
    const store = TestBed.inject(Store);
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const respond = (page: number, items: Game[]) => {
      const call = calls.find((c) => c.page === page)!;
      call.response.next({ query: 'star', page, items, totalPages: 5 });
      call.response.complete();
    };

    store.dispatch(SearchActions.searchStarted({ query: 'star' }));
    store.dispatch(SearchActions.searchSucceeded({ page: { query: 'star', page: 1, items: games(0, 30), totalPages: 5 } }));

    const viewChange = new BehaviorSubject<ListRange>({ start: 0, end: 25 });
    const dataSource = new GamesDataSource(store, 10);
    dataSource.connect({ viewChange }).subscribe();
    await flush();
    expect(calls.map((c) => c.page)).toEqual([2]);

    respond(2, games(0, 30));
    await flush();
    expect(calls.map((c) => c.page)).toEqual([2, 3]);

    respond(3, games(30, 5));
    await flush();
    expect(calls.map((c) => c.page)).toEqual([2, 3, 4]);

    respond(4, games(35, 40));
    await flush();
    expect(calls.map((c) => c.page)).toEqual([2, 3, 4]);
    dataSource.disconnect();
  });
});
