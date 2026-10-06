'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { ApiDeps, createApi, TokenOptions, TokenProvider } from './api';
import { Account } from './types';

const gh: Account = { id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth' };
const gl: Account = { id: 'a2', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const folder = { fsPath: 'C:\\repo' } as vscode.Uri;
const noopEvent: vscode.Event<void> = () => ({ dispose() {} });

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  const all = [gh, gl];
  return {
    accounts: { list: () => all, get: id => all.find(a => a.id === id) },
    accountIdForFolder: () => undefined,
    chooseAccountForFolder: async () => undefined,
    tokenProviders: {},
    onDidChange: noopEvent,
    ...overrides,
  };
}

test('getAccounts returns the stored accounts', () => {
  assert.deepStrictEqual(createApi(makeDeps()).getAccounts(), [gh, gl]);
});

test('getAccountForFolder resolves the bound account, and undefined when unbound or dangling', () => {
  assert.strictEqual(createApi(makeDeps({ accountIdForFolder: () => 'a2' })).getAccountForFolder(folder), gl);
  assert.strictEqual(createApi(makeDeps()).getAccountForFolder(folder), undefined);
  // A binding that points at an account that has since been removed.
  assert.strictEqual(createApi(makeDeps({ accountIdForFolder: () => 'gone' })).getAccountForFolder(folder), undefined);
});

test('ensureAccountForFolder returns the bound account without prompting', async () => {
  let prompted = 0;
  const api = createApi(makeDeps({ accountIdForFolder: () => 'a1', chooseAccountForFolder: async () => { prompted++; return gl; } }));
  assert.strictEqual(await api.ensureAccountForFolder(folder), gh);
  assert.strictEqual(prompted, 0);
});

test('ensureAccountForFolder prompts when unbound or dangling, and resolves undefined if the prompt fails', async () => {
  const picks = createApi(makeDeps({ chooseAccountForFolder: async () => gl }));
  assert.strictEqual(await picks.ensureAccountForFolder(folder), gl);

  const dangling = createApi(makeDeps({ accountIdForFolder: () => 'gone', chooseAccountForFolder: async () => gh }));
  assert.strictEqual(await dangling.ensureAccountForFolder(folder), gh);

  const broken = createApi(makeDeps({ chooseAccountForFolder: async () => { throw new Error('boom'); } }));
  assert.strictEqual(await broken.ensureAccountForFolder(folder), undefined);
});

test('getToken dispatches to the provider for the account and passes scopes and options through', async () => {
  const calls: Array<[string, string[] | undefined, TokenOptions | undefined]> = [];
  const github: TokenProvider = { getToken: async (a, scopes, options) => { calls.push([a.id, scopes, options]); return 'tok-gh'; } };
  const api = createApi(makeDeps({ tokenProviders: { github } }));
  assert.strictEqual(await api.getToken(gh, ['repo'], { interactive: true }), 'tok-gh');
  assert.deepStrictEqual(calls, [['a1', ['repo'], { interactive: true }]]);
});

test('getToken resolves undefined when no provider is registered for the account', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => 'x' } } }));
  assert.strictEqual(await api.getToken(gl), undefined);
});

test('getToken resolves undefined, never rejects, when the provider throws', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => { throw new Error('offline'); } } } }));
  assert.strictEqual(await api.getToken(gh), undefined);
});

test('onDidChange is the supplied event, not a wrapper', () => {
  assert.strictEqual(createApi(makeDeps()).onDidChange, noopEvent);
});
