import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/search/components/search-page/search-page.component').then((m) => m.SearchPageComponent),
    title: 'PlayLens — game deals & annotations',
  },
  { path: '**', redirectTo: '' },
];
