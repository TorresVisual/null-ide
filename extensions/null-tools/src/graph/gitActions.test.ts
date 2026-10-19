'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cherryPick, checkout, createBranch, integrateDoneText, integrateLabel, integrateUpstream, pull, pullPreference, rememberPullStrategy, reset, resetImpact, resumeOperation, revert } from './gitActions';
import { GitGraphService } from './gitGraphService';
import { makeRunGit } from './gitRun';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-actions-'));
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function tools(dir: string) {
  const run = makeRunGit(dir);
  const service = new GitGraphService(run, dir);
  return { run, inProgress: () => service.inProgress() };
}

function expectOk<T>(result: { ok: boolean; message?: string; value?: T }): T {
  assert.ok(result.ok, result.ok ? '' : String(result.message));
  return result.value as T;
}

test('checkout: a branch, a detached sha, and a remote branch that becomes a tracking branch', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  git(dir, 'branch', 'dev', first);
  const { run } = tools(dir);

  expectOk(await checkout(run, { kind: 'branch', name: 'dev' }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'dev');

  expectOk(await checkout(run, { kind: 'detach', sha: first }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), '');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);

  const clone = path.join(mkdtempSync(path.join(tmpdir(), 'graph-clone-')), 'c');
  execFileSync('git', ['clone', '-q', dir, clone]);
  git(dir, 'switch', '-q', '-c', 'feat');
  commit(dir, 'f.txt', 'f', 'feat');
  git(clone, 'fetch', '-q', 'origin');
  expectOk(await checkout(makeRunGit(clone), { kind: 'remote', name: 'origin/feat' }));
  assert.strictEqual(git(clone, 'branch', '--show-current'), 'feat');
});

test('checkout of a dirty tree is refused by git and the message comes back', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'other');
  commit(dir, 'a.txt', 'other', 'other');
  git(dir, 'switch', '-q', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  const result = await checkout(tools(dir).run, { kind: 'branch', name: 'other' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'dirty', 'nothing forced');
});

test('createBranch validates the name and switches to the new branch at the sha', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const { run } = tools(dir);
  assert.strictEqual((await createBranch(run, 'bad name', first)).ok, false);
  assert.strictEqual((await createBranch(run, '-x', first)).ok, false);
  expectOk(await createBranch(run, 'feature/x', first));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'feature/x');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);
});

function divergent(dir: string): string {
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 's.txt', 'side', 'side file');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  return side;
}

test('cherryPick applies a clean commit', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, false);
  assert.ok(existsSync(path.join(dir, 's.txt')));
});

test('a conflicting cherry-pick stops, and abort restores the tree', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 'a.txt', 'side', 'side change');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  const { run, inProgress } = tools(dir);

  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, true);
  assert.deepStrictEqual(await inProgress(), { kind: 'cherry-pick' });

  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'main');
});

test('empty cherry-pick then skip', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  expectOk(await cherryPick(run, inProgress, side));
  const again = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(again.stopped, true, 'the change is already applied, so git stops on an empty pick');
  expectOk(await resumeOperation(run, inProgress, 'skip'));
  assert.strictEqual(await inProgress(), null);
});

test('cherry-picking a merge commit needs a parent number', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 's.txt', 's', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'm.txt', 'm', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'target', 'HEAD~1');
  const { run, inProgress } = tools(dir);

  assert.strictEqual((await cherryPick(run, inProgress, merge)).ok, false);
  const info = expectOk(await cherryPick(run, inProgress, merge, 1));
  assert.strictEqual(info.stopped, false);
});

test('revert: a clean revert, then a conflicting one that can be aborted', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', 'one', 'one');
  const second = commit(dir, 'a.txt', 'two', 'two');
  commit(dir, 'a.txt', 'three', 'three');
  const { run, inProgress } = tools(dir);

  const conflicted = expectOk(await revert(run, inProgress, second));
  assert.strictEqual(conflicted.stopped, true);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);

  writeFileSync(path.join(dir, 'b.txt'), 'b');
  git(dir, 'add', '--', 'b.txt');
  git(dir, 'commit', '-q', '-m', 'add b');
  const addB = git(dir, 'rev-parse', 'HEAD');
  const clean = expectOk(await revert(run, inProgress, addB));
  assert.strictEqual(clean.stopped, false);
  assert.ok(!existsSync(path.join(dir, 'b.txt')));
  assert.ok(first);
});

test('resumeOperation fails when nothing is in progress, and a merge cannot be skipped', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  const { run, inProgress } = tools(dir);
  assert.strictEqual((await resumeOperation(run, inProgress, 'continue')).ok, false);

  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 'a.txt', 'side', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main');
  try { git(dir, 'merge', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await inProgress(), { kind: 'merge' });
  assert.strictEqual((await resumeOperation(run, inProgress, 'skip')).ok, false);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
});

test('reset soft keeps the index, mixed keeps the files, hard discards both', async () => {
  for (const mode of ['soft', 'mixed', 'hard'] as const) {
    const dir = initRepo();
    const c1 = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    expectOk(await reset(tools(dir).run, mode, c1));
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), c1, mode);
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only') !== '', mode === 'soft', `${mode}: staged`);
    assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), mode === 'hard' ? '1' : '2', `${mode}: file`);
  }
});

test('resetImpact counts what leaves the branch, what is left on no other ref, and tracked changes', async () => {
  const dir = initRepo();
  const c1 = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const c3 = commit(dir, 'a.txt', '3', 'three');
  const { run } = tools(dir);

  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 2, trackedChanges: 0 });

  git(dir, 'branch', 'keep', c3);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  writeFileSync(path.join(dir, 'untracked.txt'), 'u');
  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 0, trackedChanges: 1 });
});

// Fake git: `answers` maps the joined args to stdout; a missing key throws like a failing git.
function fakeGit(answers: Record<string, string>, calls: string[][] = []) {
  return async (args: string[]) => {
    calls.push(args);
    const key = args.join(' ');
    if (key in answers) return answers[key];
    throw new Error(`fatal: unexpected ${key}`);
  };
}

test('pull reports noUpstream when the branch tracks nothing, and runs no pull', async () => {
  const calls: string[][] = [];
  assert.deepStrictEqual(await pull(fakeGit({}, calls)), { ok: true, value: { kind: 'noUpstream' } });
  assert.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});

test('pull reports upToDate when HEAD already contains the upstream', async () => {
  const git = fakeGit({
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
    'fetch': '',
    'rev-list --count HEAD..@{u}': '0\n',
    'pull --ff-only': 'Already up to date.\n',
  });
  assert.deepStrictEqual(await pull(git), { ok: true, value: { kind: 'upToDate' } });
});

test('pull reports diverged and does not pull when local and upstream both have commits', async () => {
  const calls: string[][] = [];
  const git = fakeGit({
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
    'rev-list --count HEAD..@{u}': '2\n',
    'rev-list --count @{u}..HEAD': '1\n',
    'fetch': '',
  }, calls);
  assert.deepStrictEqual(await pull(git), { ok: true, value: { kind: 'diverged', ahead: 1, behind: 2 } });
  assert.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});

test('pull fast-forwards and counts the commits that came in', async () => {
  const git = fakeGit({
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
    'rev-list --count HEAD..@{u}': '3\n',
    'rev-list --count @{u}..HEAD': '0\n',
    'fetch': '',
    'pull --ff-only': 'Fast-forward\n',
  });
  assert.deepStrictEqual(await pull(git), { ok: true, value: { kind: 'fastForwarded', commits: 3 } });
});

test('pull fetches before it counts, so an upstream that moved on the remote is seen', async () => {
  const calls: string[][] = [];
  const git = fakeGit({
    'fetch': '',
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
    'rev-list --count HEAD..@{u}': '1\n',
    'rev-list --count @{u}..HEAD': '0\n',
    'pull --ff-only': 'Fast-forward\n',
  }, calls);
  assert.deepStrictEqual(await pull(git), { ok: true, value: { kind: 'fastForwarded', commits: 1 } });
  const keys = calls.map((a) => a.join(' '));
  assert.ok(keys.indexOf('fetch') >= 0 && keys.indexOf('fetch') < keys.indexOf('rev-list --count HEAD..@{u}'), keys.join(' | '));
});

test('pull returns git refusal text as a failure, e.g. a dirty tree', async () => {
  const git = async (args: string[]) => {
    const key = args.join(' ');
    if (key === 'fetch') return '';
    if (key.startsWith('rev-parse')) return 'origin/main\n';
    if (key === 'rev-list --count HEAD..@{u}') return '1\n';
    if (key === 'rev-list --count @{u}..HEAD') return '0\n';
    throw new Error('error: Your local changes to the following files would be overwritten by merge');
  };
  assert.deepStrictEqual(await pull(git), {
    ok: false,
    message: 'error: Your local changes to the following files would be overwritten by merge',
  });
});

test('pull passes an offline or no-credentials failure through unchanged', async () => {
  const calls: string[][] = [];
  const git = async (args: string[]) => {
    calls.push(args);
    const key = args.join(' ');
    if (key.startsWith('rev-parse')) return 'origin/main\n';
    if (key === 'fetch') throw new Error("fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    if (key === 'rev-list --count HEAD..@{u}') return '1\n';
    if (key === 'rev-list --count @{u}..HEAD') return '0\n';
    throw new Error(`fatal: unexpected ${key}`);
  };
  assert.deepStrictEqual(await pull(git), {
    ok: false,
    message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
  });
  assert.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});

// A clone whose branch has one local commit while origin has one new commit: ahead 1, behind 1, upstream already fetched.
function divergedClone(local: [file: string, content: string], remote: [file: string, content: string]): string {
  const origin = initRepo();
  commit(origin, 'a.txt', 'base', 'base');
  const clone = path.join(mkdtempSync(path.join(tmpdir(), 'graph-pull-')), 'c');
  execFileSync('git', ['clone', '-q', origin, clone]);
  for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(clone, 'config', key, value);
  }
  commit(clone, local[0], local[1], 'local change');
  commit(origin, remote[0], remote[1], 'remote change');
  git(clone, 'fetch', '-q');
  return clone;
}

test('integrateUpstream rebase puts the local commit on top of the upstream with no merge commit', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase')).stopped, false);
  assert.strictEqual(git(clone, 'log', '--format=%s'), 'local change\nremote change\nbase');
  assert.strictEqual(git(clone, 'rev-list', '--merges', '--count', 'HEAD'), '0');
  assert.strictEqual(await inProgress(), null);
});

test('integrateUpstream merge adds one merge commit that keeps both histories', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'merge')).stopped, false);
  assert.strictEqual(git(clone, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3, 'a merge commit has two parents');
  assert.strictEqual(await inProgress(), null);
});

test('a conflicting rebase or merge is a stop, and Abort puts the branch back on the same commit', async () => {
  for (const strategy of ['rebase', 'merge'] as const) {
    const clone = divergedClone(['a.txt', 'local'], ['a.txt', 'remote']);
    const { run, inProgress } = tools(clone);
    const before = git(clone, 'rev-parse', 'HEAD');
    assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, strategy)).stopped, true, strategy);
    assert.deepStrictEqual(await inProgress(), { kind: strategy }, strategy);
    expectOk(await resumeOperation(run, inProgress, 'abort'));
    assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD restored`);
    assert.strictEqual(await inProgress(), null, strategy);
    assert.strictEqual(readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'local', `${strategy}: file restored`);
  }
});

test('integrateUpstream is refused on a dirty tree, with the tree and HEAD untouched and no operation started', async () => {
  // Rebase refuses any unstaged change; merge refuses when the change overlaps what comes in.
  const cases = [
    { strategy: 'rebase', remote: ['o.txt', 'remote'] },
    { strategy: 'merge', remote: ['a.txt', 'remote'] },
  ] as const;
  for (const { strategy, remote } of cases) {
    const clone = divergedClone(['l.txt', 'local'], [remote[0], remote[1]]);
    const { run, inProgress } = tools(clone);
    const before = git(clone, 'rev-parse', 'HEAD');
    writeFileSync(path.join(clone, 'a.txt'), 'dirty');
    const result = await integrateUpstream(run, inProgress, strategy);
    assert.strictEqual(result.ok, false, strategy);
    assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD`);
    assert.strictEqual(readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'dirty', `${strategy}: file`);
    assert.strictEqual(await inProgress(), null, strategy);
  }
});

test('integrateLabel and integrateDoneText name rebase-merges distinctly from rebase', () => {
  assert.strictEqual(integrateLabel('rebase-merges'), 'Rebase (keep merges)');
  assert.strictEqual(integrateLabel('rebase'), 'Rebase');
  assert.strictEqual(integrateLabel('merge'), 'Merge');
  assert.strictEqual(integrateDoneText('rebase-merges'), 'Rebased onto the upstream, keeping merge commits.');
  assert.strictEqual(integrateDoneText('rebase'), 'Rebased onto the upstream.');
  assert.strictEqual(integrateDoneText('merge'), 'Merged the upstream.');
});

test('integrateUpstream rebase drops a local commit whose patch the upstream already has', async () => {
  // The upstream was amended or squashed: the same change exists on both sides under different hashes.
  const clone = divergedClone(['o.txt', 'same'], ['o.txt', 'same']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase')).stopped, false);
  assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', '@{u}'), 'no duplicate commit is left');
});

test('integrateUpstream rebase-merges keeps a local merge commit and adds no merge to the upstream history', async () => {
  const clone = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  // Local side branch merged into main with a real merge commit (--no-ff), on top of the diverged history.
  git(clone, 'checkout', '-b', 'side');
  commit(clone, 'side.txt', 'side', 'side');
  git(clone, 'checkout', 'main');
  git(clone, 'merge', '--no-ff', '-m', 'merge side', 'side');

  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase-merges')).stopped, false);
  assert.strictEqual(git(clone, 'rev-list', '--merges', '--count', '@{u}..HEAD'), '1');
  assert.strictEqual(git(clone, 'rev-list', '--count', '@{u}..HEAD'), '3');
});

test('integrateUpstream rebase-merges on a linear branch gives the same history as a plain rebase', async () => {
  const linear = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  const plain = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  expectOk(await integrateUpstream(tools(linear).run, tools(linear).inProgress, 'rebase-merges'));
  expectOk(await integrateUpstream(tools(plain).run, tools(plain).inProgress, 'rebase'));
  assert.strictEqual(git(linear, 'rev-list', '--merges', '--count', '@{u}..HEAD'), '0');
  assert.strictEqual(git(linear, 'log', '--format=%s', '@{u}..HEAD'), git(plain, 'log', '--format=%s', '@{u}..HEAD'));
});

test('integrateUpstream rebase-merges that conflicts stops, and Abort restores the branch', async () => {
  const clone = divergedClone(['a.txt', 'local'], ['a.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  git(clone, 'checkout', '-b', 'side');
  commit(clone, 'side.txt', 'side', 'side');
  git(clone, 'checkout', 'main');
  git(clone, 'merge', '--no-ff', '-m', 'merge side', 'side');
  const before = git(clone, 'rev-parse', 'HEAD');

  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase-merges')).stopped, true);
  assert.deepStrictEqual(await inProgress(), { kind: 'rebase' });
  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), before);
  assert.strictEqual(await inProgress(), null);
});

// fakeGit answers only the keys given; an absent key throws, which is how `git config --get` reports "unset" (exit 1).
function configGit(config: Record<string, string>, branch: string | null = 'main') {
  const answers: Record<string, string> = {};
  if (branch) answers['symbolic-ref --quiet --short HEAD'] = `${branch}\n`;
  for (const [key, value] of Object.entries(config)) answers[`config --get ${key}`] = `${value}\n`;
  const git = fakeGit(answers);
  // git exits 1 for an unset key; any other failure is an unreadable config (see pullPreference).
  return async (args: string[]) => {
    try { return await git(args); } catch (err) {
      if (args[0] === 'config') throw Object.assign(new Error('unset'), { code: 1 });
      throw err;
    }
  };
}

test('pullPreference asks when a config read fails, instead of falling through to a lower key', async () => {
  const git = configGit({ 'pull.rebase': 'true' });
  const failing = async (args: string[]) => {
    if (args.join(' ') === 'config --get branch.main.rebase') throw Object.assign(new Error('fatal: bad config line 3'), { code: 128 });
    return git(args);
  };
  assert.strictEqual(await pullPreference(failing), 'ask');
  const failingPullFf = async (args: string[]) => {
    if (args.join(' ') === 'config --get pull.ff') throw Object.assign(new Error('fatal: bad config'), { code: 128 });
    return configGit({ 'pull.rebase': 'false' })(args);
  };
  assert.strictEqual(await pullPreference(failingPullFf), 'ask');
});

test('pullPreference maps git config to a strategy', async () => {
  const cases: [Record<string, string>, string][] = [
    [{}, 'ask'],
    [{ 'pull.rebase': 'true' }, 'rebase'],
    [{ 'pull.rebase': 'false' }, 'merge'],
    [{ 'pull.ff': 'only' }, 'ff-only'],
    [{ 'pull.ff': 'false' }, 'merge'],
    [{ 'pull.ff': 'true' }, 'ask'],
    [{ 'pull.ff': 'only', 'pull.rebase': 'true' }, 'rebase'],
    [{ 'pull.ff': 'only', 'pull.rebase': 'false' }, 'ff-only'],
  ];
  for (const [config, expected] of cases) {
    assert.strictEqual(await pullPreference(configGit(config)), expected, JSON.stringify(config));
  }
});

test('pullPreference asks only for the values Null cannot act on', async () => {
  for (const value of ['interactive', 'preserve', 'nonsense']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'ask', value);
  }
});

test('pullPreference maps merges to rebase-merges, scoped and unscoped', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges' })), 'rebase-merges');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'false', 'branch.main.rebase': 'MERGES' })), 'rebase-merges');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges', 'pull.ff': 'only' })), 'rebase-merges');
});

test('pullPreference: detached HEAD with merges still returns rebase-merges, the flow reports the detached state', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges' }, null)), 'rebase-merges');
});

test('pullPreference accepts every boolean spelling git does, in any case', async () => {
  for (const value of ['true', 'TRUE', 'yes', 'on', '1']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'rebase', value);
  }
  for (const value of ['false', 'No', 'off', '0']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'merge', value);
  }
});

test('pullPreference: the branch setting beats pull.rebase', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'false', 'branch.main.rebase': 'true' })), 'rebase');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'true', 'branch.main.rebase': 'false' })), 'merge');
});

test('pullPreference on a detached HEAD uses pull.* only, and never throws when git fails', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'true' }, null)), 'rebase');
  const broken = async (): Promise<string> => { throw new Error('fatal: not a git repository'); };
  assert.strictEqual(await pullPreference(broken), 'ask');
});

test('pullPreference reads the real repo config, branch setting first', async () => {
  // Git for Windows ships pull.rebase=false in its system config; a local value cannot unset it, so ignore system and global config here.
  const isolated = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(mkdtempSync(path.join(tmpdir(), 'graph-cfg-')), 'none') };
  Object.assign(process.env, isolated);
  try {
    const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
    const { run } = tools(clone);
    assert.strictEqual(await pullPreference(run), 'ask');
    git(clone, 'config', 'pull.rebase', 'true');
    assert.strictEqual(await pullPreference(run), 'rebase');
    git(clone, 'config', 'branch.main.rebase', 'false');
    assert.strictEqual(await pullPreference(run), 'merge');
  } finally {
    for (const key of Object.keys(isolated)) delete process.env[key];
  }
});

test('rememberPullStrategy writes pull.rebase into the repo and pullPreference reads it back', async () => {
  const isolated = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(mkdtempSync(path.join(tmpdir(), 'graph-cfg-')), 'none') };
  Object.assign(process.env, isolated);
  try {
    const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
    const { run } = tools(clone);
    expectOk(await rememberPullStrategy(run, 'rebase'));
    assert.strictEqual(git(clone, 'config', '--local', '--get', 'pull.rebase'), 'true');
    assert.strictEqual(await pullPreference(run), 'rebase');
    expectOk(await rememberPullStrategy(run, 'merge'));
    assert.strictEqual(git(clone, 'config', '--local', '--get', 'pull.rebase'), 'false');
    assert.strictEqual(await pullPreference(run), 'merge');
  } finally {
    for (const key of Object.keys(isolated)) delete process.env[key];
  }
});

test('rememberPullStrategy overwrites a branch setting Null cannot read, since that key wins', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run } = tools(clone);
  const branch = git(clone, 'symbolic-ref', '--short', 'HEAD');
  git(clone, 'config', `branch.${branch}.rebase`, 'interactive');
  assert.strictEqual(await pullPreference(run), 'ask');
  expectOk(await rememberPullStrategy(run, 'merge'));
  assert.strictEqual(git(clone, 'config', '--local', '--get', `branch.${branch}.rebase`), 'false');
  assert.strictEqual(await pullPreference(run), 'merge');
});

test('rememberPullStrategy never writes outside the repository config', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  // Git for Windows ships pull.rebase=false in its system config, so compare before and after rather than expecting the key to be absent.
  const outside = (): string[] => ['--system', '--global'].map(scope => { try { return git(clone, 'config', scope, '--get', 'pull.rebase'); } catch { return ''; } });
  const before = outside();
  expectOk(await rememberPullStrategy(tools(clone).run, 'rebase'));
  assert.deepStrictEqual(outside(), before);
});

test('rememberPullStrategy returns git failures as a result and does not throw', async () => {
  const broken = async (): Promise<string> => { throw new Error('error: could not lock config file'); };
  assert.deepStrictEqual(await rememberPullStrategy(broken, 'rebase'), { ok: false, message: 'error: could not lock config file' });
});
