import { Directive, computed, input, linkedSignal } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
  host: {
    '[attr.src]': 'src()',
    '[class.img-exhausted]': 'src() === null',
    '(error)': 'next()',
  },
})
export class ImgFallbackDirective {
  readonly appImgFallback = input.required<readonly string[]>();
  private readonly urls = computed(() => this.appImgFallback(), { equal: sameUrls });
  private readonly index = linkedSignal({ source: this.urls, computation: () => 0 });
  readonly src = computed(() => this.urls()[this.index()] ?? null);

  next(): void {
    if (this.index() < this.urls().length) {
      this.index.update((i) => i + 1);
    }
  }
}

function sameUrls(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}
