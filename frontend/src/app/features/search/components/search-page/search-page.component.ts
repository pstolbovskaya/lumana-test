import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { Game } from '../../../../core/api/game.models';
import { GameDialogComponent } from '../../../annotations/components/game-dialog/game-dialog.component';
import { annotationsFeature } from '../../../annotations/store/annotations.reducer';
import { QueryHistoryActions } from '../../store/query-history.actions';
import { selectQuerySuggestions } from '../../store/query-history.selectors';
import { SearchActions } from '../../store/search.actions';
import { searchFeature } from '../../store/search.reducer';
import { ResultsListComponent } from '../results-list/results-list.component';
import { SearchBoxComponent } from '../search-box/search-box.component';

@Component({
  selector: 'app-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBoxComponent,
    ResultsListComponent,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss',
})
export class SearchPageComponent {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  readonly status = this.store.selectSignal(searchFeature.selectStatus);
  readonly query = this.store.selectSignal(searchFeature.selectQuery);
  readonly gameCount = this.store.selectSignal(searchFeature.selectGameCount);
  readonly totalPages = this.store.selectSignal(searchFeature.selectTotalPages);
  readonly loadedPage = this.store.selectSignal(searchFeature.selectLastLoadedPage);
  readonly dealCount = this.store.selectSignal(searchFeature.selectDealCount);
  readonly error = this.store.selectSignal(searchFeature.selectError);
  readonly pageError = this.store.selectSignal(searchFeature.selectPageError);
  readonly hasMore = this.store.selectSignal(searchFeature.selectHasMore);
  readonly pageLoading = this.store.selectSignal(searchFeature.selectIsPageLoading);
  readonly recent = this.store.selectSignal(selectQuerySuggestions('', 10));

  private readonly idsByGame = this.store.selectSignal(annotationsFeature.selectIdsByGame);
  readonly annotationCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const [id, ids] of Object.entries(this.idsByGame())) {
      counts[id] = ids.length;
    }
    return counts;
  });

  retryPage(): void {
    this.store.dispatch(SearchActions.nextPageRequested());
  }

  retry(): void {
    this.store.dispatch(SearchActions.retryRequested());
  }

  useRecent(query: string): void {
    this.store.dispatch(SearchActions.queryChanged({ query }));
  }

  clearHistory(): void {
    this.store.dispatch(QueryHistoryActions.historyCleared());
  }

  open(game: Game): void {
    this.dialog.open(GameDialogComponent, {
      data: game,
      width: '1100px',
      maxWidth: '96vw',
      maxHeight: '96dvh',
      autoFocus: 'dialog',
      disableClose: true,
      panelClass: 'game-dialog-panel',
    });
  }
}
