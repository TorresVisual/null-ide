'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitGraphService, resolveRepoRoot } from './gitGraphService';
import { makeRunGit } from './gitRun';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-service-'));
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

const service = (dir: string): GitGraphService => new GitGraphService(makeRunGit(dir), dir);
const real = (p: string): string => realpathSync.native(p).toLowerCase();

test('loadPage pages through history and labels HEAD, tags and branches', async () => {
  const dir = initRepo();
  const shas = [1, 2, 3, 4, 5].map((n) => commit(dir, 'a.txt', String(n), `commit ${n}`));
  git(dir, 'tag', 'v1', shas[1]);
  git(dir, 'branch', 'dev', shas[2]);

  const first = await service(dir).loadPage(0, 3);
  assert.deepStrictEqual(first.commits.map((x) => x.subject), ['commit 5', 'commit 4', 'commit 3']);
  assert.strictEqual(first.hasMore, true);
  assert.strictEqual(first.rawCount, 3);
  assert.deepStrictEqual(first.commits[0].refs, [{ name: 'main', kind: 'branch', current: true }]);
  assert.deepStrictEqual(first.commits[2].refs, [{ name: 'dev', kind: 'branch', current: false }]);

  const second = await service(dir).loadPage(3, 3);
  assert.deepStrictEqual(second.commits.map((x) => x.subject), ['commit 2', 'commit 1']);
  assert.strictEqual(second.hasMore, false);
  assert.deepStrictEqual(second.commits[0].refs, [{ name: 'v1', kind: 'tag' }]);
});

test('loadPage on an empty repository returns an empty page instead of failing', async () => {
  const dir = initRepo();
  assert.deepStrictEqual(await service(dir).loadPage(0), { commits: [], rawCount: 0, hasMore: false });
});

test('a detached HEAD gets its own label and the branch is no longer current', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  git(dir, 'checkout', '-q', '--detach', first);
  const page = await service(dir).loadPage(0);
  const byRef = (name: string) => page.commits.find((x) => x.refs.some((r) => r.name === name))!;
  assert.deepStrictEqual(byRef('HEAD').refs, [{ name: 'HEAD', kind: 'head', current: true }]);
  assert.deepStrictEqual(byRef('main').refs, [{ name: 'main', kind: 'branch', current: false }]);
});

test('refs lists branches, remotes and tags, with annotated tags peeled to their commit', async () => {
  const dir = initRepo();
  const sha = commit(dir, 'a.txt', '1', 'one');
  git(dir, 'tag', '-a', 'v2', '-m', 'annotated');
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
  git(dir, 'update-ref', 'refs/remotes/origin/HEAD', sha);
  const refs = await service(dir).refs();
  assert.deepStrictEqual(
    refs.map((r) => [r.name, r.kind, r.sha]).sort(),
    [['main', 'branch', sha], ['origin/main', 'remote', sha], ['v2', 'tag', sha]],
  );
});

test('stashes appear once each, labeled by position, without their index/untracked helper commits', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  writeFileSync(path.join(dir, 'a.txt'), 'older');
  git(dir, 'stash');
  writeFileSync(path.join(dir, 'a.txt'), 'newer');
  writeFileSync(path.join(dir, 'untracked.txt'), 'u');
  git(dir, 'stash', '-u');

  const page = await service(dir).loadPage(0);
  const subjects = page.commits.map((x) => x.subject);
  assert.ok(!subjects.some((s) => s.startsWith('index on') || s.startsWith('untracked files on')), subjects.join(' | '));
  const stashes = page.commits.filter((x) => x.refs.some((r) => r.kind === 'stash'));
  assert.deepStrictEqual(stashes.map((x) => x.refs[0].name).sort(), ['stash@{0}', 'stash@{1}']);
  assert.ok(stashes.every((x) => x.parents.length === 1));
});

test('fingerprint changes on a commit or a branch switch, not on a file edit', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', '1', 'one');
  const svc = service(dir);
  const base = (await svc.fingerprint()).hash;

  writeFileSync(path.join(dir, 'a.txt'), 'edited but not committed');
  writeFileSync(path.join(dir, 'new.txt'), 'untracked');
  assert.strictEqual((await svc.fingerprint()).hash, base);

  git(dir, 'switch', '-q', '-c', 'other');
  const switched = (await svc.fingerprint()).hash;
  assert.notStrictEqual(switched, base);

  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'two');
  assert.notStrictEqual((await svc.fingerprint()).hash, switched);
});

function conflictingCherryPick(dir: string): void {
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 'a.txt', 'side', 'side change');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
}

test('inProgress sees a stopped cherry-pick, and the fingerprint reports it', async () => {
  const dir = initRepo();
  conflictingCherryPick(dir);
  const svc = service(dir);
  assert.strictEqual(await svc.inProgress(), null);
  try { git(dir, 'cherry-pick', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await svc.inProgress(), { kind: 'cherry-pick' });
  assert.deepStrictEqual((await svc.fingerprint()).inProgress, { kind: 'cherry-pick' });
});

test('inProgress in a linked worktree is found through --git-path and stays local to that worktree', async () => {
  const dir = initRepo();
  conflictingCherryPick(dir);
  const linked = path.join(mkdtempSync(path.join(tmpdir(), 'graph-linked-')), 'wt');
  git(dir, 'worktree', 'add', '-q', '-b', 'wt', linked, 'main');
  try { git(linked, 'cherry-pick', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await service(linked).inProgress(), { kind: 'cherry-pick' });
  assert.strictEqual(await service(dir).inProgress(), null);
});

test('commitDetail returns the full message, both identities and the parents', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  writeFileSync(path.join(dir, 'a.txt'), '2');
  git(dir, 'add', '--', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'Second', '-m', 'Body line one\nBody line two');
  const sha = git(dir, 'rev-parse', 'HEAD');
  const detail = await service(dir).commitDetail(sha);
  assert.strictEqual(detail.sha, sha);
  assert.deepStrictEqual(detail.parents, [first]);
  assert.strictEqual(detail.author, 'Test');
  assert.strictEqual(detail.committerEmail, 'test@example.com');
  assert.strictEqual(detail.message, 'Second\n\nBody line one\nBody line two');
});

test('commitFiles: root commit, rename + modify, and a merge against its first parent; odd file names survive', async () => {
  const dir = initRepo();
  writeFileSync(path.join(dir, 'a b.txt'), 'content that is long enough to detect a rename\n'.repeat(5));
  writeFileSync(path.join(dir, 'é.txt'), 'x');
  writeFileSync(path.join(dir, '-dash.txt'), 'y');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'root');
  const root = git(dir, 'rev-parse', 'HEAD');

  const svc = service(dir);
  const rootFiles = await svc.commitFiles(root);
  assert.deepStrictEqual(rootFiles.map((f) => [f.status, f.path]).sort(), [['A', '-dash.txt'], ['A', 'a b.txt'], ['A', 'é.txt']]);

  git(dir, 'mv', 'a b.txt', 'c.txt');
  writeFileSync(path.join(dir, 'é.txt'), 'changed');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'rename');
  const second = git(dir, 'rev-parse', 'HEAD');
  const renamed = await svc.commitFiles(second, root);
  assert.deepStrictEqual(renamed.map((f) => [f.status, f.path, f.oldPath]).sort(), [['M', 'é.txt', undefined], ['R', 'c.txt', 'a b.txt']]);

  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 's.txt', 's', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'm.txt', 'm', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = git(dir, 'rev-parse', 'HEAD');
  const parents = (await svc.commitDetail(merge)).parents;
  assert.strictEqual(parents.length, 2);
  assert.deepStrictEqual((await svc.commitFiles(merge, parents[0])).map((f) => [f.status, f.path]), [['A', 's.txt']]);
});

test('resolveRepoRoot finds the top level from a subfolder and reports a plain folder', async () => {
  const dir = initRepo();
  mkdirSync(path.join(dir, 'sub'));
  const found = await resolveRepoRoot(path.join(dir, 'sub'));
  assert.ok(found.ok);
  if (found.ok) assert.strictEqual(real(found.root), real(dir));
  assert.deepStrictEqual(await resolveRepoRoot(mkdtempSync(path.join(tmpdir(), 'graph-plain-'))), { ok: false, reason: 'not-a-repo' });
});
