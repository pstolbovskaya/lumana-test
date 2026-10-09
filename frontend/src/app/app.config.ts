import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { ActionReducerMap, provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { routes } from './app.routes';
import { errorInterceptor } from './core/http/error.interceptor';
import { loadingInterceptor } from './core/http/loading.interceptor';
import { localStorageSync } from './core/state/local-storage-sync.meta-reducer';
import { AnnotationsState, annotationsFeature } from './features/annotations/store/annotations.reducer';
import { QueryHistoryState, queryHistoryFeature } from './features/search/store/query-history.reducer';
import { SearchEffects } from './features/search/store/search.effects';
import { SearchState, searchFeature } from './features/search/store/search.reducer';

export interface AppState {
  search: SearchState;
  queryHistory: QueryHistoryState;
  annotations: AnnotationsState;
}

const reducers: ActionReducerMap<AppState> = {
  search: searchFeature.reducer,
  queryHistory: queryHistoryFeature.reducer,
  annotations: annotationsFeature.reducer,
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([loadingInterceptor, errorInterceptor])),
    provideStore(reducers, {
      metaReducers: [localStorageSync<AppState>(['queryHistory', 'annotations'])],
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
        strictStateSerializability: true,
        strictActionSerializability: true,
      },
    }),
    provideEffects(SearchEffects),
    provideStoreDevtools({ maxAge: 50, logOnly: !isDevMode(), connectInZone: false }),
  ],
};
