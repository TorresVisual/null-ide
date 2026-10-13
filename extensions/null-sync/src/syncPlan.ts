'use strict';

import { Base, Value } from './types';

export type Action = 'none' | 'push' | 'pull' | 'conflict';

/**
 * Decides what to do with one file. `local` and `remote` are hashes of what each side holds now (`null` = absent);
 * `base` is each side's hash at the last successful sync (`undefined` = never synced on this device).
 * Each side is compared with its own half of `base`, so a pull that rewrote the text slightly does not look like a change.
 * For files that are not `deletable`, `null` is never a change: a missing file is "no local data" and is restored, not propagated.
 */
export function planFile(local: Value, remote: Value, base: Base | undefined, deletable: boolean): Action {
  if (local === remote) return 'none';
  if (local === null && (!deletable || base === undefined)) return 'pull';
  if (remote === null && (!deletable || base === undefined)) return 'push';
  if (base === undefined) return 'conflict';
  const localChanged = local !== base.local;
  const remoteChanged = remote !== base.remote;
  if (!localChanged && !remoteChanged) return 'none';
  if (!remoteChanged) return 'push';
  if (!localChanged) return 'pull';
  return 'conflict';
}

export interface FileState {
  local: Value;
  remote: Value;
  base: Base | undefined;
  deletable: boolean;
}

export function planAll(files: Record<string, FileState>): Record<string, Action> {
  return Object.fromEntries(Object.entries(files).map(([file, s]) => [file, planFile(s.local, s.remote, s.base, s.deletable)]));
}
