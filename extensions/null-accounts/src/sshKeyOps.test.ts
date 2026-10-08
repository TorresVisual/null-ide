'use strict';

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { canSign, deleteManagedKey, fingerprintOf, generateKey, readPublicKey } from './sshKeyOps';
import { managedKeyDir } from './sshKey';
import { RunTool, TOOL_UNAVAILABLE } from './tool';

const real = { skip: spawnSync('ssh-keygen', ['-?']).error ? 'ssh-keygen is not installed' : false };
const home = mkdtempSync(path.join(tmpdir(), 'null-accounts-keys-'));
after(() => rmSync(home, { recursive: true, force: true }));

const input = { home, host: 'git.uni.example', username: 'Ada', email: 'ada@uni.example' };

test('generateKey makes a passphrase-less ed25519 pair in the managed folder, and never reuses a name', real, async () => {
  const first = await generateKey(input);
  assert.strictEqual(first, path.join(managedKeyDir(home), 'git.uni.example_ada_ed25519'));
  assert.ok(existsSync(first) && existsSync(`${first}.pub`));
  const pub = readPublicKey(first);
  assert.deepStrictEqual([pub.type, pub.comment], ['ssh-ed25519', 'ada@uni.example']);

  const second = await generateKey(input);
  assert.strictEqual(second, path.join(managedKeyDir(home), 'git.uni.example_ada_2_ed25519'));
  assert.ok(existsSync(first), 'the first key is untouched');
});

test('fingerprintOf reads the SHA256 fingerprint; readPublicKey names the missing .pub', real, async () => {
  const key = await generateKey({ ...input, username: 'fp' });
  assert.match((await fingerprintOf(key)) ?? '', /^SHA256:/);
  assert.throws(() => readPublicKey(path.join(home, 'no-such-key')), /no public key/i);
});

test('canSign accepts a passphrase-less key', real, async () => {
  const key = await generateKey({ ...input, username: 'signer' });
  assert.deepStrictEqual(await canSign(key), { ok: true, message: 'ok' });
});

test('canSign refuses a key with a passphrase, with the reason and the fix', real, async () => {
  const locked = path.join(home, 'id_locked');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', 'hunter2', '-f', locked, '-q']);
  const result = await canSign(locked);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /passphrase/);
  assert.match(result.message, /ssh-keygen -p/);
});

test('canSign explains an OpenSSH too old to sign, and a missing ssh-keygen', async () => {
  const oldSsh: RunTool = async (_cmd, args) =>
    args[0] === '-y' ? { code: 0, stdout: 'ssh-ed25519 AAAA', stderr: '' } : { code: 255, stdout: '', stderr: 'unknown option -- Y' };
  const old = await canSign('/k/id', oldSsh);
  assert.strictEqual(old.ok, false);
  assert.match(old.message, /OpenSSH 8\.0/);

  const missing: RunTool = async () => ({ code: TOOL_UNAVAILABLE, stdout: '', stderr: 'spawn ssh-keygen ENOENT' });
  assert.match((await canSign('/k/id', missing)).message, /not found on your PATH/);
  await assert.rejects(generateKey(input, missing), /not found on your PATH/);
});

test('deleteManagedKey removes a managed pair, and refuses everything else — including paths that climb out', real, async () => {
  const managed = await generateKey({ ...input, username: 'doomed' });
  deleteManagedKey(managed, home);
  assert.ok(!existsSync(managed) && !existsSync(`${managed}.pub`));

  const own = path.join(home, '.ssh', 'id_ed25519');
  mkdirSync(path.dirname(own), { recursive: true });
  writeFileSync(own, 'my own key');
  assert.throws(() => deleteManagedKey(own, home), /not a key Null IDE created/);
  // Not path.join: that would normalise the `..` away before the function ever sees it.
  assert.throws(() => deleteManagedKey(`${managedKeyDir(home)}${path.sep}..${path.sep}id_ed25519`, home), /not a key Null IDE created/);
  assert.ok(existsSync(own), "the user's own key is still there");
});
