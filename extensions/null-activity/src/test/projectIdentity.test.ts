'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { NO_FOLDER, normalizeRemote, repoRoot, resolveProject } from '../projectIdentity';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-proj-'));

function repo(root: string, remotes: Record<string, string>, head = 'ref: refs/heads/main\n'): void {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), head);
  const sections = Object.entries(remotes).map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`);
  fs.writeFileSync(path.join(root, '.git', 'config'), `[core]\n\tbare = false\n${sections.join('')}`);
}

test('normalizeRemote makes ssh, https and credentialed urls identical', () => {
  const want = 'github.com/torres/null-ide';
  for (const url of [
    'git@github.com:Torres/Null-IDE.git',
    'https://github.com/Torres/null-ide.git',
    'https://user:tok@github.com/torres/null-ide',
    'ssh://git@github.com/torres/null-ide.git/',
  ]) {
    assert.strictEqual(normalizeRemote(url), want, url);
  }
});

test('no folder', () => {
  assert.deepStrictEqual(resolveProject(undefined), { key: NO_FOLDER, name: NO_FOLDER });
});

test('a folder without git is keyed by its normalized path', () => {
  const dir = path.join(tmpDir(), 'proj');
  fs.mkdirSync(dir);
  const want = path.resolve(dir).replace(/\\/g, '/');
  const r = resolveProject(dir);
  assert.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
  assert.strictEqual(r.name, 'proj');
  assert.strictEqual(r.branch, undefined);
});

test('git without a remote falls back to the path and still reports the branch', () => {
  const dir = path.join(tmpDir(), 'local-only');
  repo(dir, {});
  const r = resolveProject(dir);
  const want = path.resolve(dir).replace(/\\/g, '/');
  assert.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
  assert.strictEqual(r.branch, 'main');
});

test('ssh and https checkouts of the same repo share a key; origin wins over other remotes', () => {
  const base = tmpDir();
  repo(path.join(base, 'one'), { upstream: 'https://github.com/other/fork.git', origin: 'git@github.com:Torres/null-ide.git' });
  repo(path.join(base, 'two'), { origin: 'https://github.com/torres/null-ide.git' });
  assert.strictEqual(resolveProject(path.join(base, 'one')).key, 'github.com/torres/null-ide');
  assert.strictEqual(resolveProject(path.join(base, 'two')).key, 'github.com/torres/null-ide');
});

test('renaming the folder keeps the key and changes only the name', () => {
  const base = tmpDir();
  repo(path.join(base, 'before'), { origin: 'git@github.com:o/r.git' });
  const before = resolveProject(path.join(base, 'before'));
  fs.renameSync(path.join(base, 'before'), path.join(base, 'after'));
  const after = resolveProject(path.join(base, 'after'));
  assert.strictEqual(after.key, before.key);
  assert.deepStrictEqual([before.name, after.name], ['before', 'after']);
});

test('a detached HEAD has no branch', () => {
  const dir = path.join(tmpDir(), 'det');
  repo(dir, { origin: 'git@github.com:o/r.git' }, '0123456789abcdef0123456789abcdef01234567\n');
  assert.strictEqual(resolveProject(dir).branch, undefined);
});

test('a subfolder walks up to the repo; the name is the subfolder', () => {
  const base = tmpDir();
  repo(path.join(base, 'mono'), { origin: 'git@github.com:o/mono.git' });
  const sub = path.join(base, 'mono', 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  const r = resolveProject(sub);
  assert.deepStrictEqual([r.key, r.name], ['github.com/o/mono', 'app']);
});

test('a git worktree (.git file) uses the common config and its own HEAD', () => {
  const base = tmpDir();
  const main = path.join(base, 'main');
  repo(main, { origin: 'git@github.com:o/r.git' });
  const wtGit = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(wtGit, { recursive: true });
  fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/issue-1-x\n');
  fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`);
  assert.deepStrictEqual(resolveProject(wt), { key: 'github.com/o/r', name: 'wt', branch: 'issue-1-x' });
});

test('repoRoot finds the folder containing .git from a nested folder, and undefined without git', () => {
  const root = tmpDir();
  repo(root, { origin: 'git@github.com:o/r.git' });
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(repoRoot(nested), root);
  const plain = path.join(tmpDir(), 'plain');
  fs.mkdirSync(plain);
  assert.strictEqual(repoRoot(plain), undefined);
});
