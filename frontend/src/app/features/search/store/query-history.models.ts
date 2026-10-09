export interface QueryHistoryEntry {
  id: string;
  hits: number;
  resultCount: number;
  firstUsed: number;
  lastUsed: number;
}

export interface SuggestionSegment {
  text: string;
  match: boolean;
}

export interface QuerySuggestion {
  query: string;
  hits: number;
  lastUsed: number;
  resultCount: number;
  score: number;
  segments: SuggestionSegment[];
}
