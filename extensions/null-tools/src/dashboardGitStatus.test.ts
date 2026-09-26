'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeGitStatuses, GitStatus } from './dashboardGitStatus';

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dashboard-git-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(path.join(dir, file), file);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('computeGitStatuses reports branch and clean status for a committed repo', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([dir], (p, status) => results.set(p, status));
  const status = results.get(dir);
  assert.ok(status);
  assert.strictEqual(status!.dirty, false);
  assert.match(status!.branch, /^(main|master)$/);
});

test('computeGitStatuses reports dirty for uncommitted changes', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  writeFileSync(path.join(dir, 'a.txt'), 'changed');
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([dir], (p, status) => results.set(p, status));
  assert.strictEqual(results.get(dir)!.dirty, true);
});

test('computeGitStatuses returns null for a non-git directory without blocking others', async () => {
  const gitDir = initRepo();
  commit(gitDir, 'a.txt', 'initial');
  const nonGitDir = mkdtempSync(path.join(tmpdir(), 'dashboard-nongit-test-'));
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([nonGitDir, gitDir], (p, status) => results.set(p, status));
  assert.strictEqual(results.get(nonGitDir), null);
  assert.ok(results.get(gitDir));
});

test('computeGitStatuses never exceeds the configured concurrency cap', async () => {
  let inFlight = 0, peak = 0;
  const fakeFetch = async (): Promise<GitStatus | null> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight--;
    return { branch: 'main', dirty: false };
  };
  const paths = Array.from({ length: 10 }, (_, i) => `fake-${i}`);
  await computeGitStatuses(paths, () => {}, 3, fakeFetch);
  assert.strictEqual(peak, 3);
});

test('computeGitStatuses isolates a failing fetch from the rest of the batch', async () => {
  const fakeFetch = async (cwd: string): Promise<GitStatus | null> => {
    if (cwd === 'bad') throw new Error('boom');
    return { branch: 'main', dirty: false };
  };
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses(['bad', 'good-1', 'good-2'], (p, s) => results.set(p, s), 2, fakeFetch);
  assert.strictEqual(results.get('bad'), null);
  assert.deepStrictEqual(results.get('good-1'), { branch: 'main', dirty: false });
  assert.deepStrictEqual(results.get('good-2'), { branch: 'main', dirty: false });
});

test('computeGitStatuses supports a custom status type via generics', async () => {
  interface CustomStatus { note: string }
  const fakeFetch = async (): Promise<CustomStatus | null> => ({ note: 'ok' });
  const results = new Map<string, CustomStatus | null>();
  await computeGitStatuses<CustomStatus>(['a'], (p, s) => results.set(p, s), 1, fakeFetch);
  assert.deepStrictEqual(results.get('a'), { note: 'ok' });
});
