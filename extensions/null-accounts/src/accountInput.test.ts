'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { normalizeHost, validateNewAccount } from './accountInput';
import { NewAccount } from './types';

const base: NewAccount = {
  provider: 'github',
  host: 'github.com',
  username: 'octocat',
  email: 'octocat@example.com',
  authMethod: 'oauth',
};

test('normalizeHost lowercases and strips scheme, trailing slashes and whitespace', () => {
  assert.strictEqual(normalizeHost('  https://GitLab.com/ '), 'gitlab.com');
  assert.strictEqual(normalizeHost('GitHub.com'), 'github.com');
});

test('normalizeHost keeps an explicit port', () => {
  assert.strictEqual(normalizeHost('gitlab.example.org:8443'), 'gitlab.example.org:8443');
});

test('normalizeHost rejects http://', () => {
  assert.throws(() => normalizeHost('http://gitlab.example.org'), /http/i);
  assert.throws(() => normalizeHost('HTTP://gitlab.example.org'), /http/i);
});

test('normalizeHost rejects empty input, paths, spaces and bad ports', () => {
  for (const bad of ['', '   ', 'https://', 'gitlab.com/group', 'git lab.com', 'gitlab.com:abc', 'ftp://gitlab.com']) {
    assert.throws(() => normalizeHost(bad), `expected "${bad}" to be rejected`);
  }
});

test('validateNewAccount trims fields and normalises the host', () => {
  const out = validateNewAccount({ ...base, host: ' https://GitHub.com/ ', username: '  octocat ', email: ' octocat@example.com ' });
  assert.deepStrictEqual(out, base);
});

test('validateNewAccount rejects a blank username or an email without @', () => {
  assert.throws(() => validateNewAccount({ ...base, username: '   ' }), /username/i);
  assert.throws(() => validateNewAccount({ ...base, email: 'nope' }), /email/i);
  assert.throws(() => validateNewAccount({ ...base, email: '' }), /email/i);
});

test('validateNewAccount rejects unknown provider and auth method', () => {
  assert.throws(() => validateNewAccount({ ...base, provider: 'bitbucket' as never }), /provider/i);
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'magic' as never }), /auth/i);
});

test('validateNewAccount requires an SSH key path for ssh accounts, and keeps one on any other account', () => {
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'ssh' }), /ssh key/i);
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'ssh', sshKeyPath: '  ' }), /ssh key/i);
  assert.strictEqual(validateNewAccount({ ...base, authMethod: 'ssh', sshKeyPath: ' C:/keys/id_ed25519 ' }).sshKeyPath, 'C:/keys/id_ed25519');
  // A token account may carry a key too: git pushes over SSH with it while the token serves the API.
  assert.strictEqual(validateNewAccount({ ...base, sshKeyPath: ' C:/keys/id_ed25519 ' }).sshKeyPath, 'C:/keys/id_ed25519');
  assert.strictEqual('sshKeyPath' in validateNewAccount({ ...base, sshKeyPath: '  ' }), false);
  assert.strictEqual('sshKeyPath' in validateNewAccount(base), false);
});

test('signCommits needs a key, and is stored only when true', () => {
  assert.throws(() => validateNewAccount({ ...base, signCommits: true }), /signing needs an ssh key/i);
  assert.strictEqual(validateNewAccount({ ...base, sshKeyPath: '/k/id', signCommits: true }).signCommits, true);
  assert.strictEqual('signCommits' in validateNewAccount({ ...base, sshKeyPath: '/k/id', signCommits: false }), false);
});

test('validateNewAccount keeps a trimmed externalId and drops a blank one', () => {
  assert.strictEqual(validateNewAccount({ ...base, externalId: ' 583231 ' }).externalId, '583231');
  assert.strictEqual('externalId' in validateNewAccount({ ...base, externalId: '  ' }), false);
});

test('a git name is trimmed and kept; a blank one is dropped', () => {
  const base = { provider: 'github' as const, host: 'github.com', username: 'octocat', email: 'o@example.com', authMethod: 'oauth' as const };
  assert.strictEqual(validateNewAccount({ ...base, gitName: '  Octo Cat ' }).gitName, 'Octo Cat');
  assert.strictEqual('gitName' in validateNewAccount({ ...base, gitName: '  ' }), false);
});
