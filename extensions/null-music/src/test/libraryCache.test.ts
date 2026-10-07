'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { CACHE_VERSION, LibraryCache } from '../library/libraryCache';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-cache-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const cacheFile = () => path.join(dir, `c${n++}`, 'library-cache.json');

test('lookup reuses an entry only when mtime and size both match', () => {
  const c = new LibraryCache(cacheFile());
  c.set('/m/a.mp3', 100, 5, { title: 'A' });
  assert.deepStrictEqual(c.lookup('/m/a.mp3', 100, 5), { title: 'A' });
  assert.strictEqual(c.lookup('/m/a.mp3', 101, 5), undefined);
  assert.strictEqual(c.lookup('/m/a.mp3', 100, 6), undefined);
  assert.strictEqual(c.lookup('/m/other.mp3', 100, 5), undefined);
});

test('an untagged file caches as {} and still counts as a hit', () => {
  const c = new LibraryCache(cacheFile());
  c.set('/m/a.mp3', 1, 1, {});
  assert.deepStrictEqual(c.lookup('/m/a.mp3', 1, 1), {});
});

test('save writes atomically, load restores, prune drops unseen files', async () => {
  const file = cacheFile();
  const c = new LibraryCache(file);
  c.set('/m/a.mp3', 1, 1, { title: 'A' });
  c.set('/m/b.mp3', 2, 2, { title: 'B' });
  c.prune(new Set(['/m/a.mp3']));
  await c.save();
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['library-cache.json']); // no .tmp left

  const again = new LibraryCache(file);
  await again.load();
  assert.deepStrictEqual([...again.entries()], [['/m/a.mp3', { title: 'A' }]]);
});

test('setDuration persists the learned duration', async () => {
  const file = cacheFile();
  const c = new LibraryCache(file);
  c.set('/m/a.mp3', 1, 1, { title: 'A' });
  await c.save();
  c.setDuration('/m/a.mp3', 123000);
  await c.save();
  const again = new LibraryCache(file);
  await again.load();
  assert.strictEqual(again.lookup('/m/a.mp3', 1, 1)?.durationMs, 123000);
});

test('corrupt or wrong-version caches are discarded', async () => {
  const file = cacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const a = new LibraryCache(file);
  await a.load();
  assert.deepStrictEqual([...a.entries()], []);

  fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION + 1, entries: { '/m/a.mp3': { mtime: 1, size: 1, tags: {} } } }));
  const b = new LibraryCache(file);
  await b.load();
  assert.deepStrictEqual([...b.entries()], []);
});

test('a clean cache does not touch disk and an unwritable path never throws', async () => {
  const file = cacheFile();
  await new LibraryCache(file).save();
  assert.strictEqual(fs.existsSync(file), false);

  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const c = new LibraryCache(path.join(blocker, 'library-cache.json'));
  c.set('/m/a.mp3', 1, 1, {});
  await c.save(); // resolves
});
