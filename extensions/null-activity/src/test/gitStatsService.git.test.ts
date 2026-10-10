'use strict';

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { execGit } from '../gitExec';
import { GitStatsService } from '../gitStatsService';
import { ALL_TIME } from '../stats';

const skip = spawnSync('git', ['--version']).status !== 0 && 'git is not on PATH';

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

function commit(cwd: string, files: Record<string, string>, iso: string, author: string): void {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'c'], {
    GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
    GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: author,
  });
}

test('real repository: own commits only, local branches included, windowed by committer time', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-git-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'me@example.com']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['config', 'core.autocrlf', 'false']);
    commit(dir, { 'a.txt': '1\n2\n3\n' }, '2026-10-05T10:00:00Z', 'me@example.com');
    commit(dir, { 'a.txt': '1\n2\n3b\n4\n5\n', 'b.txt': 'x\n' }, '2026-10-06T10:00:00Z', 'me@example.com');
    commit(dir, { 'c.txt': 'c\n' }, '2026-10-06T11:00:00Z', 'other@example.com');
    git(dir, ['checkout', '-q', '-b', 'side']);
    commit(dir, { 'd.txt': '1\n2\n3\n4\n' }, '2026-10-07T10:00:00Z', 'me@example.com');
    git(dir, ['checkout', '-q', 'main']); // `side` is no longer checked out

    const service = new GitStatsService({
      folders: () => [dir], trusted: () => true, resolveKey: () => 'repo', exec: execGit, now: () => Date.now(), log: () => {},
    });
    const all = await service.load(ALL_TIME);
    assert.deepStrictEqual(all?.byProject.repo, { commits: 3, filesChanged: 3, linesAdded: 11, linesRemoved: 1 });

    const oct6 = { from: Date.parse('2026-10-06T00:00:00Z'), to: Date.parse('2026-10-07T00:00:00Z') };
    const day = await service.load(oct6);
    assert.deepStrictEqual(day?.byProject.repo, { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder that is not a repository yields no result and does not throw', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-nogit-'));
  try {
    const service = new GitStatsService({
      folders: () => [dir], trusted: () => true, resolveKey: () => 'none', exec: execGit, now: () => Date.now(), log: () => {},
    });
    assert.strictEqual(await service.load(ALL_TIME), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
