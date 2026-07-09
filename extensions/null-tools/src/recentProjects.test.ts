import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRecentProjects, RecentProjectEntry } from './recentProjects';

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

test('readRecentProjects returns [] for non-array JSON', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-nonarray-${process.pid}.json`);
  fs.writeFileSync(filePath, '{"not": "an array"}');
  try {
    assert.deepEqual(readRecentProjects(filePath), []);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('readRecentProjects parses a valid entries array', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-valid-${process.pid}.json`);
  const entries: RecentProjectEntry[] = [
    { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 123 },
  ];
  fs.writeFileSync(filePath, JSON.stringify(entries));
  try {
    assert.deepEqual(readRecentProjects(filePath), entries);
  } finally {
    fs.unlinkSync(filePath);
  }
});
