import { MemoizedSelector, createSelector } from '@ngrx/store';
import { queryHistoryFeature } from './query-history.reducer';
import { QueryHistoryEntry, QuerySuggestion, SuggestionSegment } from './query-history.models';
import { normalizeQuery, tokenize } from './query-text';

export const { selectAll: selectAllQueries, selectEntities: selectQueryEntities } = queryHistoryFeature;

export const selectQueryWordIndex = createSelector(selectAllQueries, (entries) => {
  const index = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const word of tokenize(entry.id)) {
      let ids = index.get(word);
      if (!ids) {
        ids = new Set();
        index.set(word, ids);
      }
      ids.add(entry.id);
    }
  }
  return index;
});

const DAY_MS = 24 * 60 * 60 * 1000;

function baseScore(entry: QueryHistoryEntry, newest: number): number {
  const ageDays = Math.max(0, newest - entry.lastUsed) / DAY_MS;
  const recency = 10 / (1 + ageDays);
  const popularity = Math.log2(1 + entry.hits) * 10;
  return recency + popularity;
}

export function highlightSegments(text: string, tokens: string[]): SuggestionSegment[] {
  const segments: SuggestionSegment[] = [];
  const push = (chunk: string, match: boolean) => {
    if (!chunk) return;
    const last = segments[segments.length - 1];
    if (last && last.match === match) {
      last.text += chunk;
    } else {
      segments.push({ text: chunk, match });
    }
  };
  for (const part of text.split(/(\s+)/)) {
    const lower = part.toLowerCase();
    const best = tokens
      .filter((t) => lower.startsWith(t))
      .reduce((len, t) => Math.max(len, t.length), 0);
    push(part.slice(0, best), true);
    push(part.slice(best), false);
  }
  return segments;
}

export interface SuggestionSources {
  entities: Record<string, QueryHistoryEntry | undefined>;
  all: QueryHistoryEntry[];
  index: Map<string, Set<string>>;
}

export const selectSuggestionSources = createSelector(
  selectQueryEntities,
  selectAllQueries,
  selectQueryWordIndex,
  (entities, all, index): SuggestionSources => ({ entities, all, index }),
);

export function rankSuggestions(
  input: string,
  limit: number,
  { entities, all, index }: SuggestionSources,
): QuerySuggestion[] {
  const normalized = normalizeQuery(input);
  const tokens = tokenize(normalized);
  const newest = all.reduce((max, e) => Math.max(max, e.lastUsed), 0);

  const toSuggestion = (entry: QueryHistoryEntry, score: number): QuerySuggestion => ({
    query: entry.id,
    hits: entry.hits,
    lastUsed: entry.lastUsed,
    resultCount: entry.resultCount,
    score,
    segments: highlightSegments(entry.id, tokens),
  });

  if (tokens.length === 0) {
    return all
      .map((e) => toSuggestion(e, baseScore(e, newest)))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const matchedTokens = new Map<string, number>();
  for (const token of new Set(tokens)) {
    const idsForToken = new Set<string>();
    for (const [word, ids] of index) {
      if (word.startsWith(token)) {
        ids.forEach((id) => idsForToken.add(id));
      }
    }
    idsForToken.forEach((id) => matchedTokens.set(id, (matchedTokens.get(id) ?? 0) + 1));
  }

  const tokenCount = new Set(tokens).size;
  const suggestions: QuerySuggestion[] = [];
  for (const [id, matched] of matchedTokens) {
    const entry = entities[id];
    if (!entry || id === normalized) continue;
    const coverage = matched / tokenCount;
    const wholePrefix = id.startsWith(normalized) ? 25 : 0;
    const score = coverage * 100 + wholePrefix + baseScore(entry, newest);
    suggestions.push(toSuggestion(entry, score));
  }
  return suggestions
    .sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}

export function selectQuerySuggestions(input: string, limit = 8): MemoizedSelector<object, QuerySuggestion[]> {
  return createSelector(selectSuggestionSources, (sources) => rankSuggestions(input, limit, sources));
}
