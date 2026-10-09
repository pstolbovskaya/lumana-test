import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, Subject } from 'rxjs';
import { CheapSharkApiService } from '../../../core/api/cheapshark-api.service';
import { Game, SearchPage } from '../../../core/api/game.models';
import { SearchActions } from './search.actions';
import { SEARCH_DEBOUNCE_MS, SearchEffects, estimateResultCount } from './search.effects';
import { initialSearchState } from './search.reducer';

describe('SearchEffects.search$ (typeahead pipeline)', () => {
  let actions$: Subject<Action>;
  let pending: { query: string; page: number; response: Subject<SearchPage>; cancelled: boolean }[];
  let effects: SearchEffects;
  let emitted: Action[];
  let store: MockStore;

  beforeEach(() => {
    vi.useFakeTimers();
    actions$ = new Subject<Action>();
    pending = [];
    const api = {
      search: (query: string, page: number) =>
        new Observable<SearchPage>((subscriber) => {
          const call = { query, page, response: new Subject<SearchPage>(), cancelled: false };
          pending.push(call);
          const sub = call.response.subscribe(subscriber);
          return () => {
            call.cancelled = true;
            sub.unsubscribe();
          };
        }),
    };
    TestBed.configureTestingModule({
      providers: [
        SearchEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { search: initialSearchState } }),
        { provide: CheapSharkApiService, useValue: api },
      ],
    });
    effects = TestBed.inject(SearchEffects);
    store = TestBed.inject(MockStore);
    emitted = [];
    effects.search$.subscribe((a) => emitted.push(a));
    effects.nextPage$.subscribe((a) => emitted.push(a));
  });

  afterEach(() => vi.useRealTimers());

  const type = (query: string) => actions$.next(SearchActions.queryChanged({ query }));

  it('debounces keystrokes into a single request', () => {
    type('w');
    type('wi');
    type('wit');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(pending.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pending.map((p) => p.query)).toEqual(['wit']);
    expect(emitted[0]).toEqual(SearchActions.searchStarted({ query: 'wit' }));
  });

  it('requests a repeated query again after another query (no caching)', () => {
    type('star');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    type('portal');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    type('star');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(pending.map((p) => [p.query, p.page])).toEqual([
      ['star', 1],
      ['portal', 1],
      ['star', 1],
    ]);
  });

  it('ignores 1-character input and identical normalised queries', () => {
    type('w');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(pending.length).toBe(0);

    type('Witcher');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    type('  witcher ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(pending.map((p) => p.query)).toEqual(['witcher']);
  });

  it('cancels the in-flight request when a new query arrives (switchMap)', () => {
    type('witcher');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    type('portal');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(pending.map((p) => p.query)).toEqual(['witcher', 'portal']);
    expect(pending[0].cancelled).toBe(true);
    expect(pending[0].response.observed).toBe(false);
  });

  it('clears results when the input is emptied', () => {
    type('witcher');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    type('');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(emitted.at(-1)).toEqual(SearchActions.searchCleared());
  });

  it('loads the next (1-based) page only when idle and more pages exist', () => {
    const ready = { ...initialSearchState, query: 'star', status: 'success' as const, lastLoadedPage: 2, totalPages: 42 };
    store.setState({ search: { ...ready, loadingPage: 3 } });
    actions$.next(SearchActions.nextPageRequested());
    expect(pending.length).toBe(0);

    store.setState({ search: { ...ready, lastLoadedPage: 42 } });
    actions$.next(SearchActions.nextPageRequested());
    expect(pending.length).toBe(0);

    store.setState({ search: ready });
    actions$.next(SearchActions.nextPageRequested());
    actions$.next(SearchActions.nextPageRequested());
    expect(pending.map((p) => [p.query, p.page])).toEqual([['star', 3]]);
    expect(emitted.at(-1)).toEqual(SearchActions.pageLoadStarted({ query: 'star', page: 3 }));
  });
});

describe('estimateResultCount', () => {
  const items = Array.from({ length: 26 }, (_, i) => ({ id: `steam:${i % 20}` }) as Game);
  const base = { query: 'q', page: 1, items };
  it('counts unique games for a single page and is an upper bound otherwise', () => {
    expect(estimateResultCount({ ...base, totalPages: 1 })).toBe(20);
    expect(estimateResultCount({ ...base, totalPages: 42 })).toBe(42 * 60);
  });
});
