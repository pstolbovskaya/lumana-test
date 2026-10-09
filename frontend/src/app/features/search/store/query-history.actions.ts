import { createActionGroup, emptyProps, props } from '@ngrx/store';

export const QueryHistoryActions = createActionGroup({
  source: 'Query History',
  events: {
    'Query Recorded': props<{ query: string; resultCount: number; at: number }>(),
    'Query Removed': props<{ query: string }>(),
    'History Cleared': emptyProps(),
  },
});
