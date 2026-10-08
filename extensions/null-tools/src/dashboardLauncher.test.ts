import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProjectType } from './projectType';
import {
  findCurrentRecentProject,
  readRecentProjects,
  relocateRecentProject,
  removeRecentProject,
  setRecentProjectPinned,
  writeRecentProjects,
} from './recentProjects';

function withStore(run: (file: string, dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-launcher-'));
  try { run(path.join(dir, 'recent.json'), dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const entry = (p: string, label: string, pinned = false) => ({ path: p, label, isWorkspaceFile: false, timestamp: 1, pinned });

test('findCurrentRecentProject accepts a case variant of a stored path', () => withStore(file => {
  writeRecentProjects(file, [entry('C:\Code\App', 'App')]);
  assert.equal(findCurrentRecentProject(file, 'c:\code\app')?.label, 'App');
}));

test('findCurrentRecentProject rejects a stale path after its entry is removed', () => withStore(file => {
  writeRecentProjects(file, [entry('C:\Code\App', 'App'), entry('C:\Code\Other', 'Other')]);
  removeRecentProject(file, 'C:\Code\App', 20);
  assert.equal(findCurrentRecentProject(file, 'C:\Code\App'), undefined);
  assert.equal(findCurrentRecentProject(file, 'C:\Code\Other')?.label, 'Other');
}));

test('relocateRecentProject refuses a file and leaves the record untouched', () => withStore((file, dir) => {
  const notDir = path.join(dir, 'file.txt');
  fs.writeFileSync(notDir, 'x');
  writeRecentProjects(file, [entry('C:\Missing', 'Missing', true)]);
  assert.equal(relocateRecentProject(file, 'C:\Missing', notDir, 20), false);
  assert.deepEqual(readRecentProjects(file), [entry('C:\Missing', 'Missing', true)]);
}));

test('relocateRecentProject keeps pin state and takes the new folder name as label', () => withStore((file, dir) => {
  const target = path.join(dir, 'Relocated');
  fs.mkdirSync(target);
  writeRecentProjects(file, [entry('C:\Missing', 'Missing', true)]);
  assert.equal(relocateRecentProject(file, 'C:\Missing', target, 20), true);
  assert.deepEqual(readRecentProjects(file), [entry(target, 'Relocated', true)]);
}));

test('setRecentProjectPinned only flips the selected entry', () => withStore(file => {
  writeRecentProjects(file, [entry('C:\A', 'A'), entry('C:\B', 'B')]);
  setRecentProjectPinned(file, 'C:\B', true, 20);
  assert.deepEqual(readRecentProjects(file).map(e => [e.label, e.pinned]), [['A', false], ['B', true]]);
}));

test('detectProjectType recognises Cargo, CMake, .NET, and Node roots and nothing else', () => withStore((_file, dir) => {
  const rust = path.join(dir, 'rust'); fs.mkdirSync(rust); fs.writeFileSync(path.join(rust, 'Cargo.toml'), '');
  const node = path.join(dir, 'node'); fs.mkdirSync(node); fs.writeFileSync(path.join(node, 'package.json'), '{}');
  const dotnet = path.join(dir, 'dotnet'); fs.mkdirSync(dotnet); fs.writeFileSync(path.join(dotnet, 'App.csproj'), '');
  const plain = path.join(dir, 'plain'); fs.mkdirSync(plain);
  assert.deepEqual(detectProjectType(rust), { projectType: 'Rust', icon: 'rust' });
  assert.deepEqual(detectProjectType(node), { projectType: 'Node', icon: 'node' });
  assert.deepEqual(detectProjectType(dotnet), { projectType: '.NET', icon: 'dotnet' });
  assert.equal(detectProjectType(plain), undefined);
  assert.equal(detectProjectType(path.join(dir, 'does-not-exist')), undefined);
}));
