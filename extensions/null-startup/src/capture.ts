'use strict';

import { buildReport } from './buildReport';
import { Report, Snapshot } from './types';

export const SETTLE_DELAY_MS = 30_000;

export interface CaptureDeps {
  snapshot(): Promise<Snapshot | undefined>;
  save(report: Report): Promise<void>;
  now(): number;
  windowId: string;
  schedule(fn: () => void, ms: number): { dispose(): void };
  log(message: string): void;
  onSaved(): void;
}

/**
 * One report per launch: written right after startup, then rewritten under the same id once late
 * activations have settled. Extension status is cumulative, so the later snapshot supersedes the first.
 */
export class Capture {
  private timer: { dispose(): void } | undefined;

  constructor(private readonly deps: CaptureDeps) {}

  async run(): Promise<void> {
    const id = `${this.deps.now()}-${this.deps.windowId}`;
    if (!(await this.write(id))) return;
    this.timer = this.deps.schedule(() => void this.write(id), SETTLE_DELAY_MS);
  }

  dispose(): void {
    this.timer?.dispose();
  }

  private async write(id: string): Promise<boolean> {
    try {
      const snapshot = await this.deps.snapshot();
      if (!snapshot) return false;
      await this.deps.save(buildReport(snapshot, { id, windowId: this.deps.windowId }));
      this.deps.onSaved();
      return true;
    } catch (err) {
      this.deps.log(`startup report failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
