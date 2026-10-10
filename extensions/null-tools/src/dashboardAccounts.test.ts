'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountLabel, withAccounts } from './dashboardAccounts';

const folder = (path: string, extra: object = {}) => ({ path, label: path, isWorkspaceFile: false, ...extra });
const lookup = (bound: Record<string, { username: string; host: string }>) => (p: string) => bound[p];

test('accountLabel is username@host, with the port when the host has one', () => {
  assert.equal(accountLabel({ username: 'alice', host: 'github.com' }), 'alice@github.com');
  assert.equal(accountLabel({ username: 'bob', host: 'git.example.org:8443' }), 'bob@git.example.org:8443');
});

test('withAccounts labels bound projects and leaves the others without an account key', () => {
  const result = withAccounts(
    [folder('D:/a'), folder('D:/b')],
    lookup({ 'D:/a': { username: 'alice', host: 'github.com' } }),
  );
  assert.deepEqual(result, [folder('D:/a', { account: 'alice@github.com' }), folder('D:/b')]);
  assert.ok(!('account' in result[1]));
});

test('a .code-workspace entry never gets an account and is never looked up', () => {
  const asked: string[] = [];
  const result = withAccounts(
    [folder('D:/x.code-workspace', { isWorkspaceFile: true })],
    p => { asked.push(p); return { username: 'u', host: 'h' }; },
  );
  assert.deepEqual(asked, []);
  assert.ok(!('account' in result[0]));
});

test('a project whose folder is missing on disk is still labelled: the binding outlives the folder', () => {
  const [project] = withAccounts(
    [{ ...folder('D:/gone'), available: false }],
    lookup({ 'D:/gone': { username: 'alice', host: 'github.com' } }),
  );
  assert.equal(project.account, 'alice@github.com');
  assert.equal(project.available, false);
});
