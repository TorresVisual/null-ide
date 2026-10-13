'use strict';

import { SyncStatus } from './types';

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** A one-line summary of the sync state, for the status quick pick. */
export function describeStatus(status: SyncStatus, now: number): string {
  const last = status.lastSyncedAt === undefined ? 'never synced' : `last synced ${ago(now - status.lastSyncedAt)}`;
  switch (status.state) {
    case 'disabled':
      return 'Sync is off';
    case 'signedOut':
      return 'Sign-in or setup needed';
    case 'syncing':
      return 'Syncing…';
    case 'idle':
      return `Up to date (${last})`;
    case 'offline':
      return `Offline (${last})`;
    case 'error':
      return `Error (${last})`;
    case 'needsAttention':
      return `Needs attention (${last})`;
  }
}

/** What to tell the user after an interactive command. A message wins over `idle`: a run that was skipped (another window holds the lock) is not a success. */
export function reportOf(status: SyncStatus, done: string): { level: 'info' | 'warn'; text: string } | undefined {
  if (status.message) return { level: 'warn', text: status.message };
  if (status.state === 'idle') return { level: 'info', text: done };
  if (status.state === 'needsAttention') return { level: 'info', text: 'some items need attention. Run "Null: Show Sync Status".' };
  return undefined;
}
