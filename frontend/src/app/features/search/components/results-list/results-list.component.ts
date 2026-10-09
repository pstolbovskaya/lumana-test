import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { Game } from '../../../../core/api/game.models';
import { thumbnailCandidates } from '../../../../core/api/steam-images';
import { formatPrice, metacriticTone, steamRatingTone } from '../../../../shared/game-format';
import { ImgFallbackDirective } from '../../../../shared/img-fallback.directive';
import { GamesDataSource } from '../../games.data-source';
import { searchFeature } from '../../store/search.reducer';

export const RESULT_ROW_HEIGHT = 96;

@Component({
  selector: 'app-results-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, MatIconModule, ImgFallbackDirective],
  templateUrl: './results-list.component.html',
  styleUrl: './results-list.component.scss',
})
export class ResultsListComponent {
  readonly annotationCounts = input<Record<string, number>>({});
  readonly selectGame = output<Game>();

  private readonly store = inject(Store);
  protected readonly dataSource = new GamesDataSource(this.store);

  readonly rowHeight = RESULT_ROW_HEIGHT;
  protected readonly formatPrice = formatPrice;
  protected readonly metacriticTone = metacriticTone;
  protected readonly steamRatingTone = steamRatingTone;
  protected readonly thumbs = thumbnailCandidates;

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly query = this.store.selectSignal(searchFeature.selectQuery);

  constructor() {
    effect(() => {
      this.query();
      this.viewport()?.scrollToIndex(0);
    });
  }

  trackById = (_: number, game: Game) => game.id;
}
