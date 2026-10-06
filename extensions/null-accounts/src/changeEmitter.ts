'use strict';

import type { Event } from 'vscode';

export class ChangeEmitter {
  private readonly listeners = new Set<(e: void) => unknown>();

  readonly event: Event<void> = listener => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };

  fire(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* one bad listener must not break the others or the write that fired it */ }
    }
  }
}
