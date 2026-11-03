import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { assetsDir, CacheIo, entryPath, lookup } from './cache';

const ASSETS = 'C:\\P\\Saved\\NullUnreal\\assets';
const cur = { engineVersion: '5.8.4', sourceMtime: 100, sourceSize: 2000 };
const doc = (over: Record<string, unknown> = {}) => JSON.stringify({
  schema: 1, ...cur, package: '/Game/A/T', kind: 'texture', class: 'Texture2D',
  references: { dependencies: [] }, data: {}, sidecars: { preview: 'T.png' }, ...over,
});

function io(files: Record<string, string>): CacheIo {
  return { readFile: (p) => files[p], exists: (p) => p in files };
}
const files = (json: string, withPng = true): Record<string, string> => ({
  [entryPath(ASSETS, '/Game/A/T')]: json,
  ...(withPng ? { [`${ASSETS}\\Game\\A\\T.png`]: 'png' } : {}),
});

test('the entry for a package sits under assets/<package path>.json', () => {
  assert.equal(entryPath(ASSETS, '/Game/A/T'), `${ASSETS}\\Game\\A\\T.json`);
  assert.equal(assetsDir('C:\\P'), ASSETS);
});

test('a matching entry is a hit', () => {
  assert.equal(lookup(ASSETS, '/Game/A/T', cur, io(files(doc()))).state, 'hit');
});

test('no file is an absent miss', () => {
  assert.deepEqual(lookup(ASSETS, '/Game/A/T', cur, io({})), { state: 'miss', reason: 'absent' });
});

test('a corrupt file, or one for another package, is a corrupt miss', () => {
  assert.deepEqual(lookup(ASSETS, '/Game/A/T', cur, io(files('{"sch'))), { state: 'miss', reason: 'corrupt' });
  assert.deepEqual(lookup(ASSETS, '/Game/A/T', cur, io(files(doc({ package: '/Game/Other' })))), { state: 'miss', reason: 'corrupt' });
});

test('a changed mtime, size, engine version or schema is a stale miss', () => {
  for (const changed of [{ sourceMtime: 101 }, { sourceSize: 2001 }, { engineVersion: '5.8.5' }, { schema: 2 }]) {
    assert.deepEqual(lookup(ASSETS, '/Game/A/T', cur, io(files(doc(changed)))), { state: 'miss', reason: 'stale' }, JSON.stringify(changed));
  }
});

test('a deleted sidecar makes the entry stale; an unreadable sidecar entry needs no file', () => {
  assert.deepEqual(lookup(ASSETS, '/Game/A/T', cur, io(files(doc(), false))), { state: 'miss', reason: 'stale' });
  const unreadable = doc({ sidecars: { preview: { unreadable: 'no exporter' } } });
  assert.equal(lookup(ASSETS, '/Game/A/T', cur, io(files(unreadable, false))).state, 'hit');
});
