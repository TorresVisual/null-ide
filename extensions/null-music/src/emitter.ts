'use strict';

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

export class Emitter<T> {
  private readonly listeners = new Set<(e: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };

  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error('Null Music: listener failed', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
