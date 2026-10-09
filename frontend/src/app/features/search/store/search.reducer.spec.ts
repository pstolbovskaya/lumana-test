import { toGame } from '../../../core/api/game-mapping';
import { dealDto } from '../../../core/api/game.fixtures';
import { Game, SearchPage } from '../../../core/api/game.models';
import { SearchActions } from './search.actions';
import { SearchState, initialSearchState, searchFeature } from './search.reducer';

const game = (appId: number, salePrice = 10): Game =>
  toGame(dealDto({ steamAppID: String(appId), gameID: `g${appId}`, title: `Game ${appId}`, salePrice: String(salePrice) }));

const page = (query: string, n: number, items: Game[], totalPages = 3): SearchPage => ({
  query,
  page: n,
  items,
  totalPages,
});

const all = (search: SearchState) => searchFeature.selectAllGames({ search });
const ids = (search: SearchState) => all(search).map((g) => g.id);
const reducer = searchFeature.reducer;

describe('search reducer (@ngrx/entity)', () => {
  const started = reducer(initialSearchState, SearchActions.searchStarted({ query: 'witcher' }));
  const loaded = reducer(
    started,
    SearchActions.searchSucceeded({ page: page('witcher', 1, [game(1), game(2), game(3)]) }),
  );

  it('stores the first page as EntityState in API order', () => {
    expect(loaded.status).toBe('success');
    expect(loaded.ids).toEqual(['steam:1', 'steam:2', 'steam:3']);
    expect(Object.keys(loaded.entities)).toHaveLength(3);
    expect(searchFeature.selectGameCount({ search: loaded })).toBe(3);
    expect(searchFeature.selectGameEntities({ search: loaded })['steam:2']?.title).toBe('Game 2');
    expect(loaded.lastLoadedPage).toBe(1);
    expect(loaded.dealCount).toBe(3);
  });

  it('dedupes deal rows inside a page, keeping the best deal at the first position', () => {
    const s = reducer(
      started,
      SearchActions.searchSucceeded({ page: page('witcher', 1, [game(1, 9), game(2), game(1, 3), game(1, 5)]) }),
    );
    expect(ids(s)).toEqual(['steam:1', 'steam:2']);
    expect(s.entities['steam:1']?.salePrice).toBe(3);
    expect(s.dealCount).toBe(4);
  });

  it('starts every search from an empty collection (nothing reused, even for the same query)', () => {
    const again = reducer(loaded, SearchActions.searchStarted({ query: 'witcher' }));
    expect(again.ids).toEqual([]);
    expect(again.status).toBe('loading');
    expect(again.lastLoadedPage).toBe(0);
  });

  it('ignores stale responses from a previous query', () => {
    const next = reducer(loaded, SearchActions.searchStarted({ query: 'portal' }));
    const stale = reducer(next, SearchActions.searchSucceeded({ page: page('witcher', 1, [game(9)]) }));
    expect(stale).toBe(next);
    expect(stale.ids).toEqual([]);
  });

  it('appends next pages, keeps the cheaper deal in place and ignores duplicate page loads', () => {
    let s = reducer(loaded, SearchActions.pageLoadStarted({ query: 'witcher', page: 2 }));
    expect(s.loadingPage).toBe(2);
    s = reducer(s, SearchActions.pageLoaded({ page: page('witcher', 2, [game(3, 4), game(4), game(2, 99), game(5)]) }));
    expect(ids(s)).toEqual(['steam:1', 'steam:2', 'steam:3', 'steam:4', 'steam:5']);
    expect(s.entities['steam:3']?.salePrice).toBe(4);
    expect(s.entities['steam:2']?.salePrice).toBe(10);
    expect(s.loadingPage).toBeNull();
    expect(s.dealCount).toBe(7);
    const again = reducer(s, SearchActions.pageLoaded({ page: page('witcher', 2, [game(6)]) }));
    expect(again).toBe(s);
  });

  it('advances the page cursor even when a page holds only (worse) duplicates', () => {
    let s = reducer(loaded, SearchActions.pageLoadStarted({ query: 'witcher', page: 2 }));
    s = reducer(s, SearchActions.pageLoaded({ page: page('witcher', 2, [game(1, 50), game(2, 50)]) }));
    expect(s.ids).toBe(loaded.ids);
    expect(s.entities).toBe(loaded.entities);
    expect(s.lastLoadedPage).toBe(2);
    expect(s.loadingPage).toBeNull();
    expect(searchFeature.selectHasMore({ search: s })).toBe(true);
  });

  it('keeps the cursor on a failed page and exposes the error', () => {
    let s = reducer(loaded, SearchActions.pageLoadStarted({ query: 'witcher', page: 2 }));
    s = reducer(s, SearchActions.pageLoadFailed({ query: 'witcher', page: 2, error: { status: 503, message: 'down' } }));
    expect(s.lastLoadedPage).toBe(1);
    expect(s.loadingPage).toBeNull();
    expect(s.pageError).toBe('down');
  });

  it('exposes hasMore until the last page', () => {
    expect(searchFeature.selectHasMore({ search: loaded })).toBe(true);
    const last = reducer(started, SearchActions.searchSucceeded({ page: page('witcher', 1, [game(1)], 1) }));
    expect(searchFeature.selectHasMore({ search: last })).toBe(false);
  });

  it('clears to the initial state but keeps the input text', () => {
    const typed = reducer(loaded, SearchActions.queryChanged({ query: '' }));
    const cleared = reducer(typed, SearchActions.searchCleared());
    expect(cleared.ids).toEqual([]);
    expect(cleared.status).toBe('idle');
  });
});
