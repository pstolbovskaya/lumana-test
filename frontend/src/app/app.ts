import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterOutlet } from '@angular/router';
import { LoadingService } from './core/http/loading.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, MatToolbarModule, MatIconModule, MatProgressBarModule],
  template: `
    <mat-toolbar class="app-toolbar">
      <mat-icon class="logo" aria-hidden="true">sports_esports</mat-icon>
      <span class="brand">PlayLens</span>
      <span class="tagline">Search game deals &amp; annotate key art</span>
    </mat-toolbar>
    <div class="global-progress">
      @if (loading.isLoading()) {
        <mat-progress-bar mode="indeterminate" aria-label="Loading" />
      }
    </div>
    <main class="app-main">
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100dvh; }
    .app-toolbar { gap: 10px; flex: 0 0 auto; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .logo { color: var(--mat-sys-primary); }
    .brand { font-weight: 600; letter-spacing: .2px; }
    .tagline { font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); margin-left: 8px; }
    .global-progress { height: 4px; flex: 0 0 4px; }
    .app-main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    @media (max-width: 640px) { .tagline { display: none; } }
  `,
})
export class App {
  protected readonly loading = inject(LoadingService);
}
