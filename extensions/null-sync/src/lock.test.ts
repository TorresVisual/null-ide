import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquire } from './lock';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const lockPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
  made.push(dir);
  return path.join(dir, 'nested', 'lock');
};

describe('acquire', () => {
  it('creates the folder and holds the lock until released', async () => {
    const lock = lockPath();
    const release = await acquire(lock);
    assert.ok(release);
    assert.equal(await acquire(lock), undefined, 'a second window must not get it');
    await release();
    assert.ok(await acquire(lock), 'free again after release');
  });

  it('takes over a lock older than the stale limit', async () => {
    const lock = lockPath();
    assert.ok(await acquire(lock));
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(lock, old, old);
    assert.ok(await acquire(lock), 'a crashed window must not block sync forever');
  });

  it('does not take over a fresh lock', async () => {
    const lock = lockPath();
    assert.ok(await acquire(lock));
    assert.equal(await acquire(lock, Date.now, 60_000), undefined);
  });

  it('returns undefined instead of throwing when the path is unusable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'file'), 'x');
    assert.equal(await acquire(path.join(dir, 'file', 'lock')), undefined);
  });
});
