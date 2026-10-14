'use strict';

import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ActivitySync, Exchange, LinkState, SyncPort } from '../activitySync';
import { IntervalStore } from '../intervalStore';
import { Interval } from '../types';

const at = (day: number, h: number, month = new Date().getMonth()) => new Date(new Date().getFullYear(), month, day, h).getTime();
const iv = (start: number, over: Partial<Interval> = {}): Interval => ({
  start, end: start + 30 * 60_000, project: { key: 'k', name: 'proj' }, language: 'rust', file: 'a.rs', linesAdded: 0, linesRemoved: 0, ...over,
});
const everything = { from: -Infinity, to: Infinity };

/** An in-memory stand-in for null-sync's syncActivity: one shared "Gist" of name to text; versions change with the text. */
class FakeRemote {
  files = new Map<string, string>();
  available = true;
  failWrites = false;
  patches = 0;
  port(): SyncPort {
    return {
      syncActivity: async (exchange: Exchange) => {
        if (!this.available) return false;
        const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
        const writes = await exchange({
          names: [...this.files].map(([name, text]) => ({ name, version: sha(text) })),
          read: (name) => this.files.get(name),
        });
        if (this.failWrites) return false;
        for (const [name, text] of Object.entries(writes)) {
          this.patches++;
          if (text === null) this.files.delete(name);
          else this.files.set(name, text);
        }
        return true;
      },
    };
  }
}

function device(remote: FakeRemote, id: string, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-sync-'));
  const store = new IntervalStore({ dir, windowId: 'w1', machineId: id });
  let state: LinkState = { uploaded: {}, pulled: {}, names: {} };
  let pulls = 0;
  const sync = new ActivitySync({
    store,
    machine: { id, name: () => name },
    port: async () => remote.port(),
    state: { load: () => structuredClone(state), save: (s) => { state = s; } },
    onPulled: () => pulls++,
    log: () => {},
  });
  return { store, sync, state: () => state, pulls: () => pulls };
}

const A = 'aaaaaaaaaa', B = 'bbbbbbbbbb';

test('B receives what A recorded; repeating the sync changes nothing and never duplicates', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  const b = device(remote, B, 'Laptop');
  a.store.append(iv(at(8, 10)));
  await a.sync.run();
  await b.sync.run();
  assert.deepStrictEqual(b.store.read(everything).map((i) => i.machine), [A]);
  assert.strictEqual(b.state().names[A], 'Desk');
  const patches = remote.patches;
  await a.sync.run();
  await b.sync.run();
  await b.sync.run();
  assert.strictEqual(remote.patches, patches, 'nothing uploaded again');
  assert.strictEqual(b.store.read(everything).length, 1);
  assert.strictEqual(b.pulls(), 1);
});

test('both machines see each other, and a changed month replaces the cached copy', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  const b = device(remote, B, 'Laptop');
  a.store.append(iv(at(8, 10)));
  b.store.append(iv(at(9, 10)));
  await a.sync.run();
  await b.sync.run();
  await a.sync.run();
  assert.deepStrictEqual(a.store.read(everything).map((i) => i.machine).sort(), [A, B]);
  a.store.append(iv(at(10, 10)));
  await a.sync.run();
  await b.sync.run();
  assert.strictEqual(b.store.read(everything).filter((i) => i.machine === A).length, 2);
  assert.strictEqual(b.store.read(everything).filter((i) => i.machine === B).length, 1);
});

test('deleting all data removes the blobs of that machine and the cache of them on the other', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  const b = device(remote, B, 'Laptop');
  a.store.append(iv(at(8, 10)));
  await a.sync.run();
  await b.sync.run();
  a.store.deleteAll();
  await a.sync.run();
  assert.strictEqual(remote.files.size, 0);
  await b.sync.run();
  assert.deepStrictEqual(b.store.read(everything), []);
});

test('an unreadable remote blob is skipped and the previous cache stays', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  const b = device(remote, B, 'Laptop');
  a.store.append(iv(at(8, 10)));
  await a.sync.run();
  await b.sync.run();
  const name = [...remote.files.keys()][0];
  remote.files.set(name, 'garbage');
  await b.sync.run();
  assert.strictEqual(b.store.read(everything).length, 1);
});

test('own blobs are never downloaded, and a name that is not exactly ours is ignored', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  remote.files.set('activity__../../x__2026-10.enc', 'x');
  remote.files.set('settings.json.enc', 'x');
  a.store.append(iv(at(8, 10)));
  await a.sync.run();
  assert.deepStrictEqual(a.store.remoteMonths(), []);
  assert.strictEqual(a.store.read(everything).length, 1);
});

test('when sync is unavailable or the upload fails nothing is lost and the upload is retried', async () => {
  const remote = new FakeRemote();
  const a = device(remote, A, 'Desk');
  a.store.append(iv(at(8, 10)));
  remote.available = false;
  await a.sync.run();
  assert.strictEqual(remote.files.size, 0);
  remote.available = true;
  remote.failWrites = true;
  await a.sync.run();
  assert.strictEqual(remote.files.size, 0);
  assert.deepStrictEqual(a.state().uploaded, {}, 'a failed upload is not remembered');
  remote.failWrites = false;
  await a.sync.run();
  assert.strictEqual(remote.files.size, 1);
});

test('a missing null-sync is a no-op', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-sync-'));
  const sync = new ActivitySync({
    store: new IntervalStore({ dir, windowId: 'w1', machineId: A }),
    machine: { id: A, name: () => 'x' },
    port: async () => undefined,
    state: { load: () => ({ uploaded: {}, pulled: {}, names: {} }), save: () => assert.fail('no state without a sync') },
    onPulled: () => assert.fail('nothing pulled'),
    log: () => {},
  });
  await sync.run();
});
