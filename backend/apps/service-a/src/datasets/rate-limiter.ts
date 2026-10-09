import { sleep } from '@app/common';

export class RateLimiter {
  private nextAt = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get nextRequestAt(): number {
    return this.nextAt;
  }

  defer(delayMs: number): void {
    this.nextAt = Math.max(this.nextAt, this.now() + Math.max(0, delayMs));
  }

  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.tail.then(async () => {
      for (;;) {
        signal?.throwIfAborted();
        const wait = this.nextAt - this.now();
        if (wait <= 0) break;
        await sleep(wait, signal);
      }
      this.nextAt = this.now() + this.intervalMs;
    });
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}
