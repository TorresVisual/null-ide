'use strict';

import type * as vscode from 'vscode';

export const CATEGORIES = ['settings', 'keybindings', 'snippets'] as const;
export type Category = (typeof CATEGORIES)[number];

/** A sha-256 hex digest of a file's synced content, or `null` when the file is absent. */
export type Value = string | null;

/** What each side looked like at the last successful sync; kept as a pair because a pulled `settings.json` is not byte-identical to the remote text. */
export interface Base {
  local: Value;
  remote: Value;
}

/** Remembered between runs (globalState). */
export interface StoredState {
  gistId: string;
  accountId: string;
  owner: string;
  base: Record<string, Base>;
  lastSyncedAt?: number;
}

export interface SyncAccount {
  id: string;
  username: string;
}

/** How the Enable flow resolves every first-sync conflict at once. */
export type FirstSync = 'cloud' | 'device';

export type SyncState = 'disabled' | 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error' | 'needsAttention';

export interface Conflict {
  file: string;
  category: Category;
}

export interface SyncStatus {
  state: SyncState;
  /** ms since the epoch */
  lastSyncedAt?: number;
  /** Why, for offline / error / signedOut. */
  message?: string;
  conflicts: Conflict[];
  /** Files whose pull was skipped because they have unsaved edits; retried next run. */
  pending: string[];
  pendingInstalls: string[];
  pendingRemovals: string[];
}

/** Returned from `activate`; the contract the Null workspace UI builds against. */
export interface NullSyncApi {
  getStatus(): SyncStatus;
  onDidChangeStatus: vscode.Event<void>;
  syncNow(): Promise<void>;
  resolveConflict(file: string, side: 'mine' | 'theirs'): Promise<void>;
}
