import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  upsertEntry,
  readRecentProjects,
  writeRecentProjectsAtomic,
  RecentProjectEntry,
} from './recentProjects';

test('upsertEntry adds a new entry to the front', () => {
  const result = upsertEntry([], { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false });
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'C:\\Projects\\Foo');
  assert.equal(result[0].label, 'Foo');
});

test('upsertEntry moves an existing entry (case-insensitive) to the front instead of duplicating', () => {
  const existing: RecentProjectEntry[] = [
    { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 1 },
    { path: 'C:\\Projects\\Bar', label: 'Bar', isWorkspaceFile: false, timestamp: 2 },
  ];
  const result = upsertEntry(existing, { path: 'c:\\projects\\foo', label: 'Foo', isWorkspaceFile: false });
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'c:\\projects\\foo');
  assert.equal(result[1].path, 'C:\\Projects\\Bar');
});

test('upsertEntry truncates to maxEntries', () => {
  const existing: RecentProjectEntry[] = Array.from({ length: 5 }, (_, i) => ({
    path: `C:\\Projects\\P${i}`, label: `P${i}`, isWorkspaceFile: false, timestamp: i,
  }));
  const result = upsertEntry(existing, { path: 'C:\\Projects\\New', label: 'New', isWorkspaceFile: false }, 3);
  assert.equal(result.length, 3);
  assert.equal(result[0].path, 'C:\\Projects\\New');
});

test('readRecentProjects returns [] for a missing file', () => {
  const missing = path.join(os.tmpdir(), `null-recent-projects-missing-${process.pid}.json`);
  assert.deepEqual(readRecentProjects(missing), []);
});

test('readRecentProjects returns [] for corrupt JSON', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-corrupt-${process.pid}.json`);
  fs.writeFileSync(filePath, '{not valid json');
  try {
    assert.deepEqual(readRecentProjects(filePath), []);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('writeRecentProjectsAtomic then readRecentProjects round-trips entries', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-roundtrip-${process.pid}.json`);
  const entries: RecentProjectEntry[] = [
    { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 123 },
  ];
  try {
    writeRecentProjectsAtomic(filePath, entries);
    assert.deepEqual(readRecentProjects(filePath), entries);
  } finally {
    fs.unlinkSync(filePath);
  }
});
