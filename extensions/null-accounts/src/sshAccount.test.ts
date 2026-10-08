'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildSshAccount, checkKeyPath, normalizeSshHost } from './sshAccount';

const present = new Set(['/home/me/.ssh/id_uni', 'C:/Users/me/.ssh/id_uni']);
const exists = (file: string): boolean => present.has(file);
const input = { host: 'GitLab.Uni.example', username: ' ada ', email: 'ada@uni.example', keyPath: '~/.ssh/id_uni' };

test('a university GitLab account: GitLab provider, bare host, ssh auth, key path kept as typed', () => {
  assert.deepStrictEqual(buildSshAccount(input, '/home/me', exists), {
    provider: 'gitlab', host: 'gitlab.uni.example', username: 'ada', email: 'ada@uni.example',
    authMethod: 'ssh', sshKeyPath: '~/.ssh/id_uni',
  });
});

test('github.com over SSH is a GitHub account', () => {
  assert.strictEqual(buildSshAccount({ ...input, host: 'https://github.com/' }, '/home/me', exists).provider, 'github');
});

test('a Windows key path is found after expansion, whichever way the slashes lean', () => {
  const win = { ...input, keyPath: 'C:\\Users\\me\\.ssh\\id_uni' };
  assert.strictEqual(buildSshAccount(win, 'C:\\Users\\me', exists).sshKeyPath, 'C:\\Users\\me\\.ssh\\id_uni');
});

test('the key path is checked: empty, the .pub half of a pair, and a file that is not there', () => {
  assert.match(checkKeyPath('  ', '/home/me', exists) ?? '', /Choose the private key/);
  assert.match(checkKeyPath('~/.ssh/id_uni.pub', '/home/me', exists) ?? '', /public key/);
  assert.match(checkKeyPath('~/.ssh/nope', '/home/me', exists) ?? '', /no file at ~\/\.ssh\/nope/);
  assert.strictEqual(checkKeyPath('~/.ssh/id_uni', '/home/me', exists), undefined);
});

test('a host with a port, an http:// host, or a bad email is refused with a readable message', () => {
  assert.throws(() => normalizeSshHost('git.uni.example:2222'), /without a port/);
  assert.throws(() => buildSshAccount({ ...input, host: 'http://git.uni.example' }, '/home/me', exists), /http/);
  assert.throws(() => buildSshAccount({ ...input, email: 'not-an-email' }, '/home/me', exists), /email/i);
  assert.throws(() => buildSshAccount({ ...input, keyPath: '~/.ssh/nope' }, '/home/me', exists), /no file/);
});
