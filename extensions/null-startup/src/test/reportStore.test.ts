'use strict';

import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { ReportStore, StoreFs } from '../reportStore';
import { Report } from '../types';

function memFs(): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir() {},
    async readdir(dir) {
      return [...files.keys()].filter((k) => path.dirname(k) === path.normalize(dir)).map((k) => path.basename(k));
    },
    async readFile(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async writeFile(f, d) {
      files.set(f, d);
    },
    async unlink(f) {
      files.delete(f);
    },
  };
}

const report = (id: string, takenAt: number): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1', initialStartup: true, partial: false,
  headlineMs: 1000, milestones: [], phases: [], extensions: [],
});

const make = (retention = 20) => {
  const fs = memFs();
  const logs: string[] = [];
  return { fs, logs, store: new ReportStore({ dir: '/reports', fs, retention: () => retention, log: (m) => logs.push(m) }) };
};

test('save then list returns newest first and rewriting an id replaces it', async () => {
  const { store } = make();
  await store.save(report('a', 100));
  await store.save(report('b', 300));
  await store.save(report('c', 200));
  await store.save({ ...report('a', 100), headlineMs: 42 });
  const all = await store.list();
  assert.deepStrictEqual(all.map((r) => r.id), ['b', 'c', 'a']);
  assert.strictEqual(all[2].headlineMs, 42);
});

test('save prunes the oldest reports beyond the retention limit', async () => {
  const { store } = make(2);
  for (const [id, t] of [['a', 1], ['b', 2], ['c', 3]] as const) await store.save(report(id, t));
  assert.deepStrictEqual((await store.list()).map((r) => r.id), ['c', 'b']);
});

test('corrupt, truncated and future-version files are skipped and never deleted', async () => {
  const { store, fs } = make(1);
  fs.files.set(path.join('/reports', 'bad.json'), '{ not json');
  fs.files.set(path.join('/reports', 'future.json'), JSON.stringify({ ...report('f', 1), schemaVersion: 99 }));
  fs.files.set(path.join('/reports', 'notes.txt'), 'x');
  await store.save(report('a', 10));
  await store.save(report('b', 20));
  assert.deepStrictEqual((await store.list()).map((r) => r.id), ['b']);
  assert.ok(fs.files.has(path.join('/reports', 'bad.json')));
  assert.ok(fs.files.has(path.join('/reports', 'future.json')));
  assert.ok(fs.files.has(path.join('/reports', 'notes.txt')));
});

test('an unsafe id cannot escape the reports folder', async () => {
  const { store, fs } = make();
  await store.save(report('../../evil', 1));
  assert.ok([...fs.files.keys()].every((k) => path.dirname(k) === path.normalize('/reports')));
});

test('clear removes the stored reports', async () => {
  const { store } = make();
  await store.save(report('a', 1));
  await store.clear();
  assert.deepStrictEqual(await store.list(), []);
});

test('a missing folder lists as empty', async () => {
  const fs = memFs();
  fs.readdir = async () => { throw new Error('ENOENT'); };
  const store = new ReportStore({ dir: '/nope', fs, retention: () => 5, log: () => {} });
  assert.deepStrictEqual(await store.list(), []);
});
