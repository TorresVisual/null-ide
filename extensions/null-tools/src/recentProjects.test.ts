import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readRecentProjects,
  removeRecentProject,
  setRecentProjectPinned,
  touchRecentProject,
  updateRecentProjects,
  writeRecentProjects,
} from './recentProjects';

function withStore(run: (file: string, dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-recent-projects-'));
  try { run(path.join(dir, 'recent.json'), dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('legacy entries receive defaults and unknown members are ignored', () => withStore(file => {
  fs.writeFileSync(file, JSON.stringify([
    { path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false, timestamp: 7 },
    { path: 42 },
  ]));
  assert.deepEqual(readRecentProjects(file), [{
    path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false, timestamp: 7, pinned: false,
  }]);
}));

test('readRecentProjects treats missing and malformed data as empty', () => withStore(file => {
  assert.deepEqual(readRecentProjects(file), []);
  fs.writeFileSync(file, '{not valid json');
  assert.deepEqual(readRecentProjects(file), []);
  fs.writeFileSync(file, JSON.stringify({ not: 'an array' }));
  assert.deepEqual(readRecentProjects(file), []);
}));

test('retention drops only oldest unpinned entries', () => withStore(file => {
  writeRecentProjects(file, [
    { path: 'C:\\pinned', label: 'Pinned', isWorkspaceFile: false, timestamp: 1, pinned: true },
    { path: 'C:\\middle', label: 'Middle', isWorkspaceFile: false, timestamp: 2, pinned: false },
    { path: 'C:\\newest', label: 'Newest', isWorkspaceFile: false, timestamp: 3, pinned: false },
    { path: 'C:\\oldest', label: 'Oldest', isWorkspaceFile: false, timestamp: 0, pinned: false },
  ]);
  assert.equal(updateRecentProjects(file, entries => entries, 2), true);
  assert.deepEqual(readRecentProjects(file).map(({ label }) => label), ['Newest', 'Middle', 'Pinned']);
}));

test('touch preserves enhanced fields and deduplicates case variants', () => withStore(file => {
  writeRecentProjects(file, [{
    path: 'C:\\Code\\App', label: 'Old', isWorkspaceFile: false, timestamp: 1, pinned: true,
    gitBranch: 'main', projectType: 'Node', icon: 'node',
  }]);
  assert.equal(touchRecentProject(file, {
    path: 'c:\\code\\app', label: 'App', isWorkspaceFile: false, pinned: false,
  }, 20), true);
  const [entry] = readRecentProjects(file);
  assert.equal(readRecentProjects(file).length, 1);
  assert.deepEqual(
    { path: entry.path, label: entry.label, pinned: entry.pinned, gitBranch: entry.gitBranch, projectType: entry.projectType, icon: entry.icon },
    { path: 'c:\\code\\app', label: 'App', pinned: true, gitBranch: 'main', projectType: 'Node', icon: 'node' },
  );
}));

test('pin and removal affect only the selected normalized identity', () => withStore(file => {
  writeRecentProjects(file, [
    { path: 'C:\\one', label: 'One', isWorkspaceFile: false, timestamp: 2, pinned: false },
    { path: 'C:\\two', label: 'Two', isWorkspaceFile: false, timestamp: 1, pinned: false },
  ]);
  assert.equal(setRecentProjectPinned(file, 'c:\\one', true, 20), true);
  assert.equal(removeRecentProject(file, 'C:\\two', 20), true);
  assert.deepEqual(readRecentProjects(file).map(entry => [entry.label, entry.pinned]), [['One', true]]);
}));

test('writes atomically without leaving a temporary file', () => withStore((file, dir) => {
  assert.equal(writeRecentProjects(file, [{ path: 'C:\\App', label: 'App', isWorkspaceFile: false, timestamp: 1, pinned: false }]), true);
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
}));
