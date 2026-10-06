'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseRemoteUrl, suggestAccount } from './suggest';
import { Account } from './types';

const gh = (username: string): Account =>
  ({ id: username, provider: 'github', host: 'github.com', username, email: `${username}@e.com`, authMethod: 'oauth' });
const gl: Account = { id: 'tanuki', provider: 'gitlab', host: 'gitlab.example.org', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const glPort: Account = { ...gl, id: 'tanuki8443', host: 'gitlab.example.org:8443' };

test('parseRemoteUrl reads https, ssh:// and scp-style remotes', () => {
  assert.deepStrictEqual(parseRemoteUrl('https://github.com/octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
  assert.deepStrictEqual(parseRemoteUrl('git@github.com:octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
  assert.deepStrictEqual(parseRemoteUrl('ssh://git@gitlab.example.org:2222/team/app.git'), { host: 'gitlab.example.org', owner: 'team' });
  assert.deepStrictEqual(parseRemoteUrl('https://GitLab.Example.org:8443/team/app'), { host: 'gitlab.example.org:8443', owner: 'team' });
});

test('parseRemoteUrl keeps an https login but never a password', () => {
  assert.deepStrictEqual(parseRemoteUrl('https://hubot:s3cret@github.com/acme/app.git'), { host: 'github.com', owner: 'acme', user: 'hubot' });
});

test('parseRemoteUrl returns undefined for local paths, http and junk', () => {
  for (const bad of ['C:\\repos\\app', 'C:/repos/app', '/srv/git/app.git', 'http://github.com/a/b', '', 'not a url']) {
    assert.strictEqual(parseRemoteUrl(bad), undefined, `expected "${bad}" to be rejected`);
  }
});

test('suggestAccount prefers the embedded login, then the owner', () => {
  const accounts = [gh('octocat'), gh('hubot'), gl];
  assert.strictEqual(suggestAccount('git@github.com:HuBot/app.git', accounts)?.id, 'hubot');
  assert.strictEqual(suggestAccount('https://octocat@github.com/hubot/app.git', accounts)?.id, 'octocat');
});

test('suggestAccount falls back to the only account on the host, but not when that is ambiguous', () => {
  assert.strictEqual(suggestAccount('git@gitlab.example.org:team/app.git', [gh('octocat'), gl])?.id, 'tanuki');
  assert.strictEqual(suggestAccount('git@github.com:acme/app.git', [gh('octocat'), gh('hubot')]), undefined);
});

test('suggestAccount needs the host (including an https port) to match', () => {
  assert.strictEqual(suggestAccount('https://gitlab.example.org:8443/team/app', [glPort])?.id, 'tanuki8443');
  assert.strictEqual(suggestAccount('https://gitlab.example.org/team/app', [glPort]), undefined);
  assert.strictEqual(suggestAccount('git@bitbucket.org:team/app.git', [gh('octocat')]), undefined);
  assert.strictEqual(suggestAccount('not a url', [gh('octocat')]), undefined);
});
