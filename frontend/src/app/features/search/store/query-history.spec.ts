import { QueryHistoryActions } from './query-history.actions';
import { initialQueryHistoryState, queryHistoryFeature, QueryHistoryState } from './query-history.reducer';
import {
  highlightSegments,
  rankSuggestions,
  selectQuerySuggestions,
  selectSuggestionSources,
} from './query-history.selectors';
import { normalizeQuery, tokenize } from './query-text';

const reducer = queryHistoryFeature.reducer;
const record = (state: QueryHistoryState, query: string, at: number, resultCount = 10) =>
  reducer(state, QueryHistoryActions.queryRecorded({ query, resultCount, at }));

const MINUTE = 60_000;

describe('query text helpers', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeQuery('  Van   GOGH ')).toBe('van gogh');
  });
  it('tokenizes into words', () => {
    expect(tokenize('Water-Lilies, Monet')).toEqual(['water', 'lilies', 'monet']);
  });
});

describe('queryHistory reducer', () => {
  it('ignores queries without results', () => {
    const state = record(initialQueryHistoryState, 'zzqq', 0, 0);
    expect(state.ids.length).toBe(0);
  });

  it('dedupes by normalized text and counts hits', () => {
    let state = record(initialQueryHistoryState, 'Monet', 0);
    state = record(state, '  monet ', 10 * MINUTE);
    expect(state.ids).toEqual(['monet']);
    expect(state.entities['monet']).toMatchObject({ hits: 2, lastUsed: 10 * MINUTE, firstUsed: 0 });
  });

  it('collapses transient prefixes typed just before a longer query', () => {
    let state = record(initialQueryHistoryState, 'van', 0);
    state = record(state, 'van g', 1_000);
    state = record(state, 'van gogh', 2_000);
    expect(state.ids).toEqual(['van gogh']);
  });

  it('keeps older or repeatedly used prefixes', () => {
    let state = record(initialQueryHistoryState, 'van', 0);
    state = record(state, 'van gogh', 10 * MINUTE);
    expect(state.ids).toContain('van');

    let state2 = record(initialQueryHistoryState, 'cat', 0);
    state2 = record(state2, 'cat', 1_000);
    state2 = record(state2, 'cats', 2_000);
    expect(state2.ids).toContain('cat');
  });

  it('does not record a prefix produced by backspacing', () => {
    let state = record(initialQueryHistoryState, 'van gogh', 0);
    state = record(state, 'van go', 1_000);
    expect(state.ids).toEqual(['van gogh']);
  });

  it('orders entries by recency', () => {
    let state = record(initialQueryHistoryState, 'monet', 0);
    state = record(state, 'picasso', MINUTE);
    state = record(state, 'monet', 2 * MINUTE);
    expect(state.ids).toEqual(['monet', 'picasso']);
  });
});

describe('selectQuerySuggestions', () => {
  const build = () => {
    let s = initialQueryHistoryState;
    s = record(s, 'claude monet water lilies', 0);
    s = record(s, 'van gogh self portrait', MINUTE);
    s = record(s, 'monet', 2 * MINUTE);
    s = record(s, 'monet', 3 * MINUTE);
    s = record(s, 'picasso', 4 * MINUTE);
    return { queryHistory: s };
  };

  it('matches any word prefix, not only the start of the query', () => {
    const result = selectQuerySuggestions('wat', 8)(build());
    expect(result.map((r) => r.query)).toEqual(['claude monet water lilies']);
  });

  it('ranks queries matching all typed words first, then by hits', () => {
    const result = selectQuerySuggestions('mo lil', 8)(build());
    expect(result[0].query).toBe('claude monet water lilies');
    expect(result.map((r) => r.query)).toContain('monet');
  });

  it('excludes the exact current query', () => {
    const result = selectQuerySuggestions('monet', 8)(build());
    expect(result.map((r) => r.query)).toEqual(['claude monet water lilies']);
  });

  it('returns recent / popular queries for empty input', () => {
    const result = selectQuerySuggestions('', 2)(build());
    expect(result.map((r) => r.query)).toEqual(['monet', 'picasso']);
  });

  it('creates a plain selector per call (no instance registry); NgRx memoizes each one', () => {
    expect(selectQuerySuggestions('van')).not.toBe(selectQuerySuggestions('van'));
    const state = build();
    const selector = selectQuerySuggestions('van');
    expect(selector(state)).toBe(selector(state));
  });

  it('rankSuggestions over selectSuggestionSources matches the selector factory', () => {
    const state = build();
    expect(rankSuggestions('mo lil', 8, selectSuggestionSources(state))).toEqual(
      selectQuerySuggestions('mo lil', 8)(state),
    );
  });

  it('highlights matched word prefixes', () => {
    expect(highlightSegments('van gogh', ['go'])).toEqual([
      { text: 'van ', match: false },
      { text: 'go', match: true },
      { text: 'gh', match: false },
    ]);
  });
});
