import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  Point,
  Size,
  angleTo,
  bounds,
  centroid,
  denormalize,
  distance,
  pointInPolygon,
  rotateNormalized,
  translateClamped,
} from '../../geometry/geometry';
import { Polygon } from '../../store/polygon.model';

export type EditorMode = 'draw' | 'select';

const HANDLE_HIT_RADIUS = 10;
const ROTATE_HANDLE_OFFSET = 32;
const ROTATE_SNAP = Math.PI / 12;
const WHEEL_STEP = Math.PI / 36;

type DragState =
  | { kind: 'move'; id: string; start: Point; original: Point[] }
  | { kind: 'rotate'; id: string; startAngle: number; centerPx: Point; original: Point[] };

@Component({
  selector: 'app-polygon-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './polygon-editor.component.html',
  styleUrl: './polygon-editor.component.scss',
})
export class PolygonEditorComponent {
  readonly sources = input.required<readonly string[]>();
  readonly alt = input('');
  readonly polygons = input.required<Polygon[]>();
  readonly mode = input<EditorMode>('draw');
  readonly selectedId = model<string | null>(null);

  readonly polygonCreated = output<Point[]>();
  readonly polygonChanged = output<{ id: string; points: Point[] }>();
  readonly polygonDeleted = output<string>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly imageRef = viewChild.required<ElementRef<HTMLImageElement>>('image');

  readonly imageState = signal<'loading' | 'loaded' | 'error'>('loading');
  readonly sourceIndex = linkedSignal({ source: this.sources, computation: () => 0 });
  readonly src = computed(() => this.sources()[this.sourceIndex()] ?? null);
  readonly usingFallback = computed(() => this.imageState() === 'loaded' && this.sourceIndex() > 0);
  readonly size = signal<Size>({ width: 0, height: 0 });
  readonly draft = signal<Point[]>([]);
  private readonly pointer = signal<Point | null>(null);
  private readonly preview = signal<{ id: string; points: Point[] } | null>(null);
  readonly cursor = signal('crosshair');

  private drag: DragState | null = null;
  private frame = 0;
  private dpr = 1;

  private readonly renderedPolygons = computed(() => {
    const preview = this.preview();
    return this.polygons().map((p) => (preview && p.id === preview.id ? { ...p, points: preview.points } : p));
  });

  readonly hint = computed(() => {
    if (this.mode() === 'draw') {
      const n = this.draft().length;
      if (n === 0) return 'Click to place the first vertex';
      if (n < 3) return 'Keep clicking to add vertices · Esc to cancel';
      return 'Click the first vertex, double-click or press Enter to close · Backspace removes last vertex';
    }
    return this.selectedId()
      ? 'Drag to move · drag the round handle or use the mouse wheel to rotate (Shift snaps 15°) · Delete removes'
      : 'Click a polygon to select it';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      this.renderedPolygons();
      this.draft();
      this.pointer();
      this.selectedId();
      this.size();
      this.mode();
      this.scheduleDraw();
    });

    effect(() => {
      if (this.mode() === 'draw') {
        this.selectedId.set(null);
      } else {
        this.draft.set([]);
      }
    });

    effect((onCleanup) => {
      const img = this.imageRef().nativeElement;
      const observer = new ResizeObserver(() => this.syncSize());
      observer.observe(img);
      const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onDpr = () => this.scheduleDraw(true);
      dprQuery.addEventListener('change', onDpr);
      onCleanup(() => {
        observer.disconnect();
        dprQuery.removeEventListener('change', onDpr);
      });
    });

    destroyRef.onDestroy(() => cancelAnimationFrame(this.frame));
  }

  onImageLoad(): void {
    this.imageState.set('loaded');
    this.syncSize();
  }

  onImageError(): void {
    if (this.sourceIndex() < this.sources().length - 1) {
      this.imageState.set('loading');
      this.sourceIndex.update((i) => i + 1);
      return;
    }
    this.imageState.set('error');
  }

  private syncSize(): void {
    const img = this.imageRef().nativeElement;
    const width = img.offsetWidth;
    const height = img.offsetHeight;
    const current = this.size();
    if (Math.abs(current.width - width) > 0.5 || Math.abs(current.height - height) > 0.5) {
      this.size.set({ width, height });
    }
  }

  rotateSelected(angle: number): void {
    const polygon = this.selected();
    if (!polygon) return;
    this.polygonChanged.emit({ id: polygon.id, points: rotateNormalized(polygon.points, angle, this.size()) });
  }

  handleKey(event: KeyboardEvent): boolean {
    const draft = this.draft();
    switch (event.key) {
      case 'Enter':
        if (draft.length >= 3) {
          this.finishDraft();
          return true;
        }
        return false;
      case 'Escape':
        if (this.drag) {
          this.cancelDrag();
          return true;
        }
        if (draft.length) {
          this.draft.set([]);
          return true;
        }
        if (this.selectedId()) {
          this.selectedId.set(null);
          return true;
        }
        return false;
      case 'Backspace':
      case 'Delete':
        if (draft.length) {
          this.draft.set(draft.slice(0, -1));
          return true;
        }
        if (this.selectedId()) {
          this.polygonDeleted.emit(this.selectedId()!);
          this.selectedId.set(null);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.imageState() !== 'loaded') return;
    const canvas = this.canvasRef().nativeElement;
    canvas.focus({ preventScroll: true });
    const p = this.toNormalized(event);

    if (this.mode() === 'draw') {
      this.addDraftVertex(p);
      return;
    }

    const selected = this.selected();
    if (selected) {
      const handle = this.rotateHandle(selected.points);
      if (distance(this.toPx(p), handle.knob) <= HANDLE_HIT_RADIUS) {
        this.drag = {
          kind: 'rotate',
          id: selected.id,
          centerPx: handle.center,
          startAngle: angleTo(handle.center, this.toPx(p)),
          original: selected.points,
        };
        canvas.setPointerCapture(event.pointerId);
        this.cursor.set('grabbing');
        return;
      }
    }

    const hit = this.hitTest(p);
    this.selectedId.set(hit?.id ?? null);
    if (hit) {
      this.drag = { kind: 'move', id: hit.id, start: p, original: hit.points };
      canvas.setPointerCapture(event.pointerId);
      this.cursor.set('grabbing');
    }
  }

  onPointerMove(event: PointerEvent): void {
    const p = this.toNormalized(event);
    this.pointer.set(p);
    const drag = this.drag;

    if (drag?.kind === 'move') {
      this.preview.set({
        id: drag.id,
        points: translateClamped(drag.original, p.x - drag.start.x, p.y - drag.start.y),
      });
      return;
    }
    if (drag?.kind === 'rotate') {
      let angle = angleTo(drag.centerPx, this.toPx(p)) - drag.startAngle;
      if (event.shiftKey) angle = Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP;
      this.preview.set({ id: drag.id, points: rotateNormalized(drag.original, angle, this.size()) });
      return;
    }
    this.cursor.set(this.cursorFor(p));
  }

  onPointerUp(event: PointerEvent): void {
    const canvas = this.canvasRef().nativeElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    const preview = this.preview();
    if (this.drag && preview) {
      this.polygonChanged.emit(preview);
    }
    this.drag = null;
    this.preview.set(null);
    this.cursor.set(this.cursorFor(this.toNormalized(event)));
  }

  onPointerLeave(): void {
    if (!this.drag) this.pointer.set(null);
  }

  onDoubleClick(event: MouseEvent): void {
    if (this.mode() === 'draw' && this.draft().length >= 3) {
      event.preventDefault();
      this.finishDraft();
    }
  }

  onWheel(event: WheelEvent): void {
    const selected = this.selected();
    if (this.mode() !== 'select' || !selected || this.drag) return;
    event.preventDefault();
    const step = event.shiftKey ? ROTATE_SNAP : WHEEL_STEP;
    this.rotateSelected(Math.sign(event.deltaY || event.deltaX) * step);
  }

  private addDraftVertex(p: Point): void {
    const draft = this.draft();
    const px = this.toPx(p);
    if (draft.length >= 3 && distance(px, this.toPx(draft[0])) <= HANDLE_HIT_RADIUS) {
      this.finishDraft();
      return;
    }
    if (draft.length && distance(px, this.toPx(draft[draft.length - 1])) < 3) {
      return;
    }
    this.draft.set([...draft, p]);
  }

  private finishDraft(): void {
    const draft = this.draft();
    if (draft.length >= 3) {
      this.polygonCreated.emit(draft);
    }
    this.draft.set([]);
  }

  private cancelDrag(): void {
    this.drag = null;
    this.preview.set(null);
  }

  private selected(): Polygon | undefined {
    const id = this.selectedId();
    return id ? this.renderedPolygons().find((p) => p.id === id) : undefined;
  }

  private hitTest(p: Point): Polygon | undefined {
    const polygons = this.renderedPolygons();
    for (let i = polygons.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, polygons[i].points)) return polygons[i];
    }
    return undefined;
  }

  private cursorFor(p: Point): string {
    if (this.mode() === 'draw') {
      const draft = this.draft();
      return draft.length >= 3 && distance(this.toPx(p), this.toPx(draft[0])) <= HANDLE_HIT_RADIUS
        ? 'pointer'
        : 'crosshair';
    }
    const selected = this.selected();
    if (selected && distance(this.toPx(p), this.rotateHandle(selected.points).knob) <= HANDLE_HIT_RADIUS) {
      return 'grab';
    }
    return this.hitTest(p) ? 'move' : 'default';
  }

  private rotateHandle(points: Point[]): { center: Point; knob: Point; anchor: Point } {
    const px = denormalize(points, this.size());
    const center = centroid(px);
    const b = bounds(px);
    const anchor = { x: center.x, y: b.minY };
    return { center, anchor, knob: { x: center.x, y: Math.max(8, b.minY - ROTATE_HANDLE_OFFSET) } };
  }

  private toNormalized(event: MouseEvent): Point {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    return {
      x: rect.width ? (event.clientX - rect.left) / rect.width : 0,
      y: rect.height ? (event.clientY - rect.top) / rect.height : 0,
    };
  }

  private toPx(p: Point): Point {
    const { width, height } = this.size();
    return { x: p.x * width, y: p.y * height };
  }

  private scheduleDraw(force = false): void {
    if (force) this.dpr = 0;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const canvas = this.canvasRef().nativeElement;
    const { width, height } = this.size();
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(width * dpr));
    const pxH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH || this.dpr !== dpr) {
      canvas.width = pxW;
      canvas.height = pxH;
      this.dpr = dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;

    const selectedId = this.selectedId();
    for (const polygon of this.renderedPolygons()) {
      this.drawPolygon(ctx, polygon, polygon.id === selectedId);
    }
    const selected = this.selected();
    if (selected && this.mode() === 'select') {
      this.drawRotateHandle(ctx, selected);
    }
    this.drawDraft(ctx);
  }

  private drawPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon, selected: boolean): void {
    const pts = denormalize(polygon.points, this.size());
    ctx.save();
    this.tracePath(ctx, pts, true);
    ctx.fillStyle = withAlpha(polygon.color, selected ? 0.38 : 0.24);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = selected ? 2.5 : 2;
    ctx.strokeStyle = polygon.color;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (selected) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of pts) {
      this.drawVertex(ctx, p, polygon.color, selected ? 4.5 : 3);
    }
    ctx.restore();
  }

  private drawRotateHandle(ctx: CanvasRenderingContext2D, polygon: Polygon): void {
    const { center, anchor, knob } = this.rotateHandle(polygon.points);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(knob.x, knob.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = polygon.color;
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 4, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawDraft(ctx: CanvasRenderingContext2D): void {
    const draft = this.draft();
    if (!draft.length || this.mode() !== 'draw') return;
    const pts = denormalize(draft, this.size());
    const pointer = this.pointer();
    const color = '#ffd740';
    ctx.save();
    ctx.lineJoin = 'round';

    if (pts.length >= 3) {
      this.tracePath(ctx, pointer ? [...pts, this.toPx(pointer)] : pts, true);
      ctx.fillStyle = withAlpha(color, 0.15);
      ctx.fill();
    }
    this.tracePath(ctx, pts, false);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (pointer) {
      const last = pts[pts.length - 1];
      const ptr = this.toPx(pointer);
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(ptr.x, ptr.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    pts.forEach((p, i) => this.drawVertex(ctx, p, color, i === 0 ? 5 : 3.5));
    if (pointer && pts.length >= 3 && distance(this.toPx(pointer), pts[0]) <= HANDLE_HIT_RADIUS) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, HANDLE_HIT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  private tracePath(ctx: CanvasRenderingContext2D, pts: Point[], close: boolean): void {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (close) ctx.closePath();
  }

  private drawVertex(ctx: CanvasRenderingContext2D, p: Point, color: string, radius: number): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
