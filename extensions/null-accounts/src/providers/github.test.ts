'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { Account } from '../types';
import { GITHUB_SCOPES, GithubDeps, GithubProvider } from './github';

const session = (id: string, login: string, token = 'tok'): vscode.AuthenticationSession =>
  ({ id: `s-${id}`, accessToken: token, account: { id, label: login }, scopes: GITHUB_SCOPES });

const emails = [
  { email: 'old@example.com', primary: false, verified: true },
  { email: 'octo@example.com', primary: true, verified: true },
];

function makeDeps(opts: { session?: vscode.AuthenticationSession; reject?: boolean; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ scopes: readonly string[]; options: vscode.AuthenticationGetSessionOptions }> = [];
  const apiCalls: string[] = [];
  const deps: GithubDeps = {
    getSession: async (scopes, options) => {
      calls.push({ scopes, options });
      if (opts.reject) { throw new Error('User did not consent to login.'); }
      return opts.session;
    },
    api: async path => {
      apiCalls.push(path);
      const r = opts.api?.[path];
      if (r === undefined || r instanceof Error) { throw r ?? new Error(`GitHub API 404 for ${path}`); }
      return r;
    },
  };
  return { deps, calls, apiCalls };
}

const octocat: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-583231',
};

test('signIn forces a new session and describes the account from /user and the primary email', async () => {
  const { deps, calls } = makeDeps({
    session: session('vsc-583231', 'octocat'),
    api: { '/user': { id: 583231, login: 'octocat', email: null }, '/user/emails': emails },
  });
  const account = await new GithubProvider(deps).signIn();
  assert.deepStrictEqual(account, {
    provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
    externalId: 'vsc-583231', // the session's account id, not the numeric /user id
  });
  assert.deepStrictEqual(calls[0].scopes, GITHUB_SCOPES);
  assert.deepStrictEqual(calls[0].options, { forceNewSession: true });
});

test('signIn resolves undefined without calling the API when the user cancels', async () => {
  const { deps, apiCalls } = makeDeps({ reject: true });
  assert.strictEqual(await new GithubProvider(deps).signIn(), undefined);
  assert.deepStrictEqual(apiCalls, []);
});

test('signIn surfaces an API failure instead of storing a half-described account', async () => {
  const { deps } = makeDeps({ session: session('1', 'octocat') });
  await assert.rejects(new GithubProvider(deps).signIn(), /404/);
});

test('email falls back to the profile email, then to the noreply address, and never fails the sign-in', async () => {
  const user = { id: 583231, login: 'octocat', email: 'profile@example.com' };
  const emailFor = async (api: Record<string, unknown>) =>
    (await new GithubProvider(makeDeps({ session: session('1', 'octocat'), api }).deps).signIn())?.email;

  // /user/emails unavailable (e.g. token lacks user:email) -> profile email
  assert.strictEqual(await emailFor({ '/user': user, '/user/emails': new Error('GitHub API 403') }), 'profile@example.com');
  // primary exists but is unverified -> ignored
  assert.strictEqual(
    await emailFor({ '/user': { ...user, email: null }, '/user/emails': [{ email: 'x@e.com', primary: true, verified: false }] }),
    '583231+octocat@users.noreply.github.com',
  );
  // private email, nothing from /user/emails
  assert.strictEqual(
    await emailFor({ '/user': { ...user, email: null }, '/user/emails': 'not-a-list' }),
    '583231+octocat@users.noreply.github.com',
  );
});

test('existing reads the signed-in session silently, and is undefined when there is none', async () => {
  const withSession = makeDeps({ session: session('1', 'octocat'), api: { '/user': { id: 1, login: 'octocat', email: 'o@e.com' }, '/user/emails': [] } });
  assert.strictEqual((await new GithubProvider(withSession.deps).existing())?.username, 'octocat');
  assert.deepStrictEqual(withSession.calls[0].options, { silent: true });

  assert.strictEqual(await new GithubProvider(makeDeps().deps).existing(), undefined);
});

test('getToken is silent by default, targets the account, and unions scopes with the defaults', async () => {
  const { deps, calls } = makeDeps({ session: session('vsc-583231', 'octocat', 'ghp_x') });
  const provider = new GithubProvider(deps);
  assert.strictEqual(await provider.getToken(octocat, ['read:org', 'repo']), 'ghp_x');
  assert.deepStrictEqual(calls[0].scopes, ['repo', 'user:email', 'read:org']);
  assert.deepStrictEqual(calls[0].options, { account: { id: 'vsc-583231', label: 'octocat' }, silent: true });

  await provider.getToken(octocat, undefined, { interactive: true });
  assert.deepStrictEqual(calls[1].scopes, GITHUB_SCOPES);
  assert.deepStrictEqual(calls[1].options, { account: { id: 'vsc-583231', label: 'octocat' }, createIfNone: true });
});

test('getToken refuses a session that belongs to a different GitHub account', async () => {
  const { deps } = makeDeps({ session: session('vsc-999', 'mallory', 'ghp_wrong') });
  assert.strictEqual(await new GithubProvider(deps).getToken(octocat, undefined, { interactive: true }), undefined);
});

test('getToken returns undefined without asking VS Code for accounts it cannot identify', async () => {
  const { deps, calls } = makeDeps({ session: session('x', 'y') });
  const provider = new GithubProvider(deps);
  assert.strictEqual(await provider.getToken({ ...octocat, externalId: undefined }), undefined);
  assert.strictEqual(await provider.getToken({ ...octocat, provider: 'gitlab' }), undefined);
  assert.deepStrictEqual(calls, []);
});
