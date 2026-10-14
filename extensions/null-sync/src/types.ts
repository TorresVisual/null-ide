'use strict';

import type * as vscode from 'vscode';

export const CATEGORIES = ['settings', 'keybindings', 'snippets', 'extensions', 'activity'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Activity is off until the user asks for it: it uploads history that earlier sync users never agreed to share. */
export const CATEGORY_DEFAULTS: Record<Category, boolean> = { settings: true, keybindings: true, snippets: true, extensions: true, activity: false };

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
  /** The extension IDs both sides had at the last sync (see extensionSet.ts). */
  extensionsBase?: string[];
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

/** The activity blobs in the Gist (Gist file name starts with `activity__`), as seen by `NullSyncApi.syncActivity`. */
export interface ActivityBlobs {
  names: { name: string; version: string }[];
  /** The decrypted text, or `undefined` if it is missing or cannot be decrypted. */
  read(name: string): string | undefined;
}
/** Returns the blobs to write (`null` deletes); names must start with `activity__`. */
export type ActivityExchange = (remote: ActivityBlobs) => Promise<Record<string, string | null>>;

/** Returned from `activate`; the contract the Null workspace UI builds against. */
export interface NullSyncApi {
  getStatus(): SyncStatus;
  onDidChangeStatus: vscode.Event<void>;
  syncNow(): Promise<void>;
  resolveConflict(file: string, side: 'mine' | 'theirs'): Promise<void>;
  /** Uninstalls an extension that was removed on another device (an entry of `pendingRemovals`). */
  uninstallRemoved(id: string): Promise<void>;
  /**
   * Gives `null-activity` the encrypted activity blobs of the sync Gist and uploads what it returns, in one request.
   * Silent and never throws; `false` when sync or the `activity` category is off, no token or passphrase is available
   * without a prompt, another window is syncing, or the Gist could not be read or written.
   */
  syncActivity(exchange: ActivityExchange): Promise<boolean>;
}
