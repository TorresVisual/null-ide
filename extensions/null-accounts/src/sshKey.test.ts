'use strict';

import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import {
  isManagedKey, keyFileName, keygenArgs, keyTitle, managedKeyDir, parseFingerprint, parsePublicKey, uniqueKeyPath,
} from './sshKey';

const HOME = path.resolve('/home/me');

test('keyFileName turns host and user into one file name that is safe on every OS', () => {
  assert.strictEqual(keyFileName('git.example.org:8443', 'Ada Lovelace'), 'git.example.org_8443_ada_lovelace');
  assert.strictEqual(keyFileName('github.com', '../../x'), 'github.com_.._.._x');
  assert.ok(!/[\\/:]/.test(keyFileName('a:b', 'c/d\\e')));
});

test('uniqueKeyPath never picks a file that is already there, key or .pub', () => {
  const dir = path.join(HOME, 'keys');
  const taken = new Set([path.join(dir, 'gh_ada_ed25519'), `${path.join(dir, 'gh_ada_2_ed25519')}.pub`]);
  const exists = (f: string): boolean => taken.has(f);
  assert.strictEqual(uniqueKeyPath(dir, 'gh_ada', exists), path.join(dir, 'gh_ada_3_ed25519'));
  assert.strictEqual(uniqueKeyPath(dir, 'other', exists), path.join(dir, 'other_ed25519'));
});

test('keygenArgs is an argv: an empty passphrase and the comment are single elements, no shell involved', () => {
  assert.deepStrictEqual(keygenArgs('/k/id one', 'ada@uni.example'),
    ['-t', 'ed25519', '-f', '/k/id one', '-N', '', '-C', 'ada@uni.example', '-q']);
});

test('parsePublicKey reads type, key and comment from the first line', () => {
  const key = parsePublicKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA ada@uni.example laptop\n');
  assert.deepStrictEqual(key, {
    type: 'ssh-ed25519', blob: 'AAAAC3NzaC1lZDI1NTE5AAAA', comment: 'ada@uni.example laptop',
    line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA ada@uni.example laptop',
  });
  assert.strictEqual(parsePublicKey('ssh-ed25519 AAAA').comment, '');
});

test('parsePublicKey refuses a private key and anything that is not a public key line', () => {
  assert.throws(() => parsePublicKey('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY-----'), /private key/i);
  assert.throws(() => parsePublicKey('hello world'), /not a public key/i);
  assert.throws(() => parsePublicKey(''), /not a public key/i);
});

test('parseFingerprint finds the SHA256 fingerprint in ssh-keygen -l output', () => {
  assert.strictEqual(parseFingerprint('256 SHA256:Zk3q+Abc/def12 ada@uni.example (ED25519)\n'), 'SHA256:Zk3q+Abc/def12');
  assert.strictEqual(parseFingerprint('nonsense'), undefined);
});

test('keyTitle names the machine and the day, so keys can be told apart on the server', () => {
  assert.strictEqual(keyTitle('DESKTOP-1', new Date('2026-10-09T23:30:00Z')), 'Null IDE on DESKTOP-1 (2026-10-09)');
});

test('isManagedKey is true only inside ~/.ssh/null-accounts, whichever way the path is written', () => {
  const dir = managedKeyDir(HOME);
  assert.strictEqual(isManagedKey(path.join(dir, 'gh_ada_ed25519'), HOME), true);
  assert.strictEqual(isManagedKey('~/.ssh/null-accounts/gh_ada_ed25519', HOME), true);
  assert.strictEqual(isManagedKey(path.join(HOME, '.ssh', 'id_ed25519'), HOME), false);
  assert.strictEqual(isManagedKey('~/.ssh/null-accounts/../id_ed25519', HOME), false);
  assert.strictEqual(isManagedKey(dir, HOME), false);
});
