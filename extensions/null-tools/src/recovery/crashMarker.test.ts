import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findCrashed, isPidAlive, removeMarker, sharesFolder, writeMarker } from './crashMarker';

const DAY = 24 * 3600 * 1000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-'));
}

test('a marker whose pid is dead is reported as crashed', () => {
  const dir = tempDir();
  try {
    const marker = { pid: 4242, startedAt: 1000, folders: ['D:\\Repo'] };
    const file = writeMarker(dir, marker);
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), [{ file, marker }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a marker whose pid is alive is not crashed, and removeMarker clears it', () => {
  const dir = tempDir();
  try {
    const file = writeMarker(dir, { pid: 4242, startedAt: 1000, folders: [] });
    assert.deepEqual(findCrashed(dir, () => true, 2000, DAY), []);
    removeMarker(file);
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), []);
    removeMarker(file); // already gone: must not throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt marker is deleted and ignored', () => {
  const dir = tempDir();
  try {
    const bad = path.join(dir, '1-1.json');
    fs.writeFileSync(bad, '{nope');
    const wrongShape = path.join(dir, '2-2.json');
    fs.writeFileSync(wrongShape, JSON.stringify({ pid: 'x', startedAt: 1, folders: [] }));
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), []);
    assert.equal(fs.existsSync(bad), false);
    assert.equal(fs.existsSync(wrongShape), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a marker older than the max age is deleted even though its pid is dead', () => {
  const dir = tempDir();
  try {
    const file = writeMarker(dir, { pid: 4242, startedAt: 0, folders: ['D:\\Repo'] });
    assert.deepEqual(findCrashed(dir, () => false, 31 * DAY, 30 * DAY), []);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeMarker leaves no temp file behind and temp files are never read as markers', () => {
  const dir = tempDir();
  try {
    writeMarker(dir, { pid: 1, startedAt: 1, folders: [] });
    fs.writeFileSync(path.join(dir, '9-9.json.tmp'), '{"half');
    assert.deepEqual(fs.readdirSync(dir).filter(f => f === '1-1.json.tmp'), []);
    assert.equal(findCrashed(dir, () => false, 2000, DAY).length, 1);
    assert.equal(fs.existsSync(path.join(dir, '9-9.json.tmp')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findCrashed on a missing directory returns an empty list', () => {
  assert.deepEqual(findCrashed(path.join(os.tmpdir(), 'null-recovery-does-not-exist'), () => false, 1, DAY), []);
});

test('isPidAlive: this process is alive, an absurd pid is not', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(2147483646), false);
});

test('sharesFolder compares workspace folders case-insensitively', () => {
  assert.equal(sharesFolder(['D:\\Coding\\Repo'], ['d:\\coding\\repo']), true);
  assert.equal(sharesFolder(['D:\\Coding\\Repo', 'D:\\Other'], ['d:\\other']), true);
  assert.equal(sharesFolder(['D:\\Coding\\Repo'], ['D:\\Coding\\Different']), false);
  assert.equal(sharesFolder([], ['D:\\Coding\\Repo']), false);
});
