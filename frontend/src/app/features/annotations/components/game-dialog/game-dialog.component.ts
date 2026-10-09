import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { Game } from '../../../../core/api/game.models';
import { heroCandidates } from '../../../../core/api/steam-images';
import { compactCount, dealUrl, formatPrice, metacriticTone, steamRatingTone } from '../../../../shared/game-format';
import { Point } from '../../geometry/geometry';
import { AnnotationsActions } from '../../store/annotations.actions';
import { selectPolygonsForGame } from '../../store/annotations.reducer';
import { POLYGON_COLORS } from '../../store/polygon.model';
import { EditorMode, PolygonEditorComponent } from '../polygon-editor/polygon-editor.component';

const ROTATE_STEP = Math.PI / 12;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

@Component({
  selector: 'app-game-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    PolygonEditorComponent,
  ],
  templateUrl: './game-dialog.component.html',
  styleUrl: './game-dialog.component.scss',
})
export class GameDialogComponent {
  private readonly store = inject(Store);
  private readonly dialogRef = inject<MatDialogRef<GameDialogComponent>>(MatDialogRef);
  readonly game = inject<Game>(MAT_DIALOG_DATA);

  private readonly editor = viewChild(PolygonEditorComponent);

  readonly imageSources = heroCandidates(this.game);
  readonly dealUrl = dealUrl(this.game.dealId);
  readonly polygons = this.store.selectSignal(selectPolygonsForGame(this.game.id));

  protected readonly formatPrice = formatPrice;
  protected readonly compactCount = compactCount;
  protected readonly metacriticTone = metacriticTone;
  protected readonly steamRatingTone = steamRatingTone;
  readonly mode = signal<EditorMode>(this.polygons().length ? 'select' : 'draw');
  readonly selectedId = signal<string | null>(null);
  readonly hasSelection = computed(() => this.selectedId() !== null);

  constructor() {
    this.dialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (this.editor()?.handleKey(event)) {
          event.preventDefault();
          event.stopPropagation();
        } else if (event.key === 'Escape') {
          this.dialogRef.close();
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !this.isTyping(event)) {
          if (event.key === 'd') this.mode.set('draw');
          if (event.key === 's' || event.key === 'v') this.mode.set('select');
        }
      });
    this.dialogRef
      .backdropClick()
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dialogRef.close());
  }

  onPolygonCreated(points: Point[]): void {
    const now = Date.now();
    const id = newId();
    this.store.dispatch(
      AnnotationsActions.polygonAdded({
        polygon: {
          id,
          gameId: this.game.id,
          points,
          color: POLYGON_COLORS[this.polygons().length % POLYGON_COLORS.length],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }

  onPolygonChanged({ id, points }: { id: string; points: Point[] }): void {
    this.store.dispatch(AnnotationsActions.polygonPointsChanged({ id, points, at: Date.now() }));
  }

  onPolygonDeleted(id: string): void {
    this.store.dispatch(AnnotationsActions.polygonRemoved({ id }));
  }

  rotate(direction: 1 | -1): void {
    this.editor()?.rotateSelected(direction * ROTATE_STEP);
  }

  deleteSelected(): void {
    const id = this.selectedId();
    if (id) {
      this.onPolygonDeleted(id);
      this.selectedId.set(null);
    }
  }

  clearAll(): void {
    this.store.dispatch(AnnotationsActions.gamePolygonsCleared({ gameId: this.game.id }));
    this.selectedId.set(null);
  }

  private isTyping(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  }
}
