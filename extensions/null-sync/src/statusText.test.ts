import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { describeStatus } from './statusText';
import { SyncState, SyncStatus } from './types';

const status = (state: SyncState, lastSyncedAt?: number): SyncStatus => ({
  state,
  lastSyncedAt,
  conflicts: [],
  pending: [],
  pendingInstalls: [],
  pendingRemovals: [],
});
const NOW = 10 * 24 * 3_600_000;
const MINUTE = 60_000;

describe('describeStatus', () => {
  it('says what each state means', () => {
    assert.equal(describeStatus(status('disabled'), NOW), 'Sync is off');
    assert.equal(describeStatus(status('signedOut'), NOW), 'Sign-in or setup needed');
    assert.equal(describeStatus(status('syncing'), NOW), 'Syncing…');
  });

  it('adds when it last synced', () => {
    assert.equal(describeStatus(status('idle', NOW - 30_000), NOW), 'Up to date (last synced just now)');
    assert.equal(describeStatus(status('offline', NOW - 5 * MINUTE), NOW), 'Offline (last synced 5 min ago)');
    assert.equal(describeStatus(status('error', NOW - 3 * 60 * MINUTE), NOW), 'Error (last synced 3 h ago)');
    assert.equal(describeStatus(status('needsAttention', NOW - 2 * 24 * 60 * MINUTE), NOW), 'Needs attention (last synced 2 d ago)');
  });

  it('says so when it has never synced', () => {
    assert.equal(describeStatus(status('idle'), NOW), 'Up to date (never synced)');
  });
});
