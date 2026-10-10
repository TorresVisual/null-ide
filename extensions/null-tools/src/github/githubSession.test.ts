'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { AccountLike, AccountsApiLike, resolveGithubSession } from './githubSession';

const folder = { fsPath: 'C:\\repo' } as vscode.Uri;
const octocat: AccountLike = { provider: 'github', host: 'github.com', username: 'octocat' };
const tanuki: AccountLike = { provider: 'gitlab', host: 'gitlab.com', username: 'tanuki' };

function makeApi(opts: { bound?: AccountLike; picked?: AccountLike; token?: string } = {}) {
  const log: string[] = [];
  const api: AccountsApiLike = {
    getAccountForFolder: () => opts.bound,
    ensureAccountForFolder: async () => { log.push('ensure'); return opts.picked; },
    getToken: async (_account, scopes, options) => { log.push(`token:${scopes}:${options?.interactive}`); return opts.token; },
    onDidChange: () => ({ dispose() {} }),
  };
  return { api, log };
}

test('a bound GitHub account yields its token and login, silently when not interactive', async () => {
  const { api, log } = makeApi({ bound: octocat, token: 'ghp_x' });
  assert.deepStrictEqual(await resolveGithubSession(api, folder, false), { accessToken: 'ghp_x', login: 'octocat' });
  assert.deepStrictEqual(log, ['token:repo:false']);
});

test('an unbound folder stays signed out when silent, and prompts to pick or add when interactive', async () => {
  const silent = makeApi({ token: 'ghp_x' });
  assert.strictEqual(await resolveGithubSession(silent.api, folder, false), undefined);
  assert.deepStrictEqual(silent.log, []);

  const interactive = makeApi({ picked: octocat, token: 'ghp_x' });
  assert.deepStrictEqual(await resolveGithubSession(interactive.api, folder, true), { accessToken: 'ghp_x', login: 'octocat' });
  assert.deepStrictEqual(interactive.log, ['ensure', 'token:repo:true']);

  const cancelled = makeApi({});
  assert.strictEqual(await resolveGithubSession(cancelled.api, folder, true), undefined);
});

test('a folder bound to a non-GitHub account never gets a GitHub session', async () => {
  const { api, log } = makeApi({ bound: tanuki, token: 'glpat_x' });
  assert.strictEqual(await resolveGithubSession(api, folder, true), undefined);
  assert.deepStrictEqual(log, []);
});

test('no token, no accounts extension, or no folder all resolve undefined', async () => {
  assert.strictEqual(await resolveGithubSession(makeApi({ bound: octocat }).api, folder, false), undefined);
  assert.strictEqual(await resolveGithubSession(undefined, folder, true), undefined);
  assert.strictEqual(await resolveGithubSession(makeApi({ bound: octocat, token: 't' }).api, undefined, true), undefined);
});
