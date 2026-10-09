import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { map, startWith } from 'rxjs';
import { rankSuggestions, selectSuggestionSources } from '../../store/query-history.selectors';
import { normalizeQuery } from '../../store/query-text';
import { SearchActions } from '../../store/search.actions';
import { searchFeature } from '../../store/search.reducer';

@Component({
  selector: 'app-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss',
})
export class SearchBoxComponent {
  private readonly store = inject(Store);

  readonly control = new FormControl(this.store.selectSignal(searchFeature.selectInput)(), { nonNullable: true });
  readonly searching = this.store.selectSignal(searchFeature.selectIsInitialLoading);

  private readonly typed = toSignal(this.control.valueChanges.pipe(startWith(this.control.value), map(normalizeQuery)), {
    initialValue: '',
  });
  private readonly history = this.store.selectSignal(selectSuggestionSources);

  readonly suggestions = computed(() => rankSuggestions(this.typed(), 8, this.history()));

  private readonly storeInput = this.store.selectSignal(searchFeature.selectInput);

  constructor() {
    effect(() => {
      const value = this.storeInput();
      if (value !== this.control.value) {
        this.control.setValue(value, { emitEvent: false });
      }
    });

    this.control.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((query) => this.store.dispatch(SearchActions.queryChanged({ query })));
  }

  clear(): void {
    this.control.setValue('');
  }
}
