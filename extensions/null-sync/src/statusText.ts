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
