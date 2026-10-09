import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ImgFallbackDirective } from './img-fallback.directive';

@Component({
  imports: [ImgFallbackDirective],
  template: `<img [appImgFallback]="urls()" alt="" />`,
})
class HostComponent {
  readonly urls = signal<string[]>(['https://a/1.jpg', 'https://a/2.jpg']);
}

describe('ImgFallbackDirective', () => {
  it('walks the candidates on error, then gives up, and resets on new input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://a/1.jpg');

    img.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(img.getAttribute('src')).toBe('https://a/2.jpg');

    img.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.classList).toContain('img-exhausted');

    fixture.componentInstance.urls.set(['https://b/1.jpg']);
    await fixture.whenStable();
    expect(img.getAttribute('src')).toBe('https://b/1.jpg');
    expect(img.classList).not.toContain('img-exhausted');
  });

  it('keeps its position when it receives a new array with the same URLs', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    img.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(img.getAttribute('src')).toBe('https://a/2.jpg');

    fixture.componentInstance.urls.set(['https://a/1.jpg', 'https://a/2.jpg']);
    await fixture.whenStable();
    expect(img.getAttribute('src')).toBe('https://a/2.jpg');
  });
});
