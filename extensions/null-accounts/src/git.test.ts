'use strict';

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GIT_UNAVAILABLE, originUrl, runGit } from './git';

test('originUrl reads origin from a real repo, and is undefined for a non-repo or a repo without origin', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'null-accounts-git-'));
  try {
    assert.strictEqual(await originUrl(dir), undefined);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    assert.strictEqual(await originUrl(dir), undefined);
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:octocat/hello.git'], { cwd: dir });
    assert.strictEqual(await originUrl(dir), 'git@github.com:octocat/hello.git');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runGit reports the exit code, feeds stdin, and tells "git could not start" apart from "git said no"', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'null-accounts-rungit-'));
  try {
    const notRepo = await runGit(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.strictEqual(notRepo.code, 128);
    assert.notStrictEqual(notRepo.stderr, '');

    // The blob id of "hello\n" is fixed, so a matching id proves the input reached git's stdin.
    const hashed = await runGit(dir, ['hash-object', '--stdin'], 'hello\n');
    assert.deepStrictEqual([hashed.code, hashed.stdout.trim()], [0, 'ce013625030ba8dba906f756967f9e9ca394464a']);

    const gone = await runGit(path.join(dir, 'does-not-exist'), ['--version']);
    assert.strictEqual(gone.code, GIT_UNAVAILABLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
