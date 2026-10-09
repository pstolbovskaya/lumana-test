import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { AppHttpError } from '../../../core/http/app-http-error';
import { SearchPage } from '../../../core/api/game.models';

export const SearchActions = createActionGroup({
  source: 'Search',
  events: {
    'Query Changed': props<{ query: string }>(),
    'Search Started': props<{ query: string }>(),
    'Search Succeeded': props<{ page: SearchPage }>(),
    'Search Failed': props<{ query: string; error: AppHttpError }>(),
    'Search Cleared': emptyProps(),
    'Retry Requested': emptyProps(),

    'Next Page Requested': emptyProps(),
    'Page Load Started': props<{ query: string; page: number }>(),
    'Page Loaded': props<{ page: SearchPage }>(),
    'Page Load Failed': props<{ query: string; page: number; error: AppHttpError }>(),
  },
});
