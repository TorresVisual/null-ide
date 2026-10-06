'use strict';

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { originUrl } from './git';

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
