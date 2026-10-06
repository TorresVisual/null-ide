'use strict';

import path from 'node:path';
import { MetadataStore } from './accountStore';
import { ChangeEmitter } from './changeEmitter';

export const BINDINGS_KEY = 'null-accounts.bindings';

/** Stable key for a folder: absolute, forward slashes, no trailing separator; case-folded on Windows (case-insensitive filesystem). */
export function folderKey(fsPath: string, platform: NodeJS.Platform = process.platform): string {
  const win = platform === 'win32';
  const resolved = (win ? path.win32 : path.posix).resolve(fsPath).replace(/\\/g, '/');
  return win ? resolved.toLowerCase() : resolved;
}

/**
 * folder key -> account id, in `globalState` so the dashboard can read bindings for projects that
 * aren't open. Every write reads and updates with no `await` in between, so overlapping calls
 * can't lose each other's changes.
 */
export class ProjectBinding {
  private readonly emitter = new ChangeEmitter();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly meta: MetadataStore,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  accountIdFor(folderPath: string): string | undefined {
    return this.read()[folderKey(folderPath, this.platform)];
  }

  /** Every binding as [folder key, account id]. Keys are in `folderKey` form (lower-cased on Windows). */
  entries(): [string, string][] {
    return Object.entries(this.read());
  }

  async bind(folderPath: string, accountId: string): Promise<void> {
    const key = folderKey(folderPath, this.platform);
    const bindings = this.read();
    if (bindings[key] === accountId) { return; }
    await this.write({ ...bindings, [key]: accountId });
  }

  async unbind(folderPath: string): Promise<void> {
    const key = folderKey(folderPath, this.platform);
    const { [key]: removed, ...rest } = this.read();
    if (removed === undefined) { return; }
    await this.write(rest);
  }

  /** Drops bindings whose account no longer exists. */
  async prune(validIds: ReadonlySet<string>): Promise<void> {
    const entries = Object.entries(this.read());
    const kept = entries.filter(([, id]) => validIds.has(id));
    if (kept.length === entries.length) { return; }
    await this.write(Object.fromEntries(kept));
  }

  private read(): Record<string, string> {
    const raw = this.meta.get<unknown>(BINDINGS_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }

  private async write(bindings: Record<string, string>): Promise<void> {
    await this.meta.update(BINDINGS_KEY, bindings);
    this.emitter.fire();
  }
}
