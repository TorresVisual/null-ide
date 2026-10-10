'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { renderHostBlocks, syncSshConfig, withInclude, withoutInclude } from './sshConfig';
import { Account } from './types';

const tugraz: Account = {
  id: 'a1', provider: 'gitlab', host: 'gitlab-teaching.tugraz.at', username: 'me', email: 'me@example.com',
  authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\null-accounts\\tugraz_ed25519',
};
const github: Account = { ...tugraz, id: 'a2', provider: 'github', host: 'github.com', authMethod: 'oauth', sshKeyPath: '~/.ssh/gh' };

test('each host gets one block with its keys; accounts without a key are left out', () => {
  const noKey: Account = { ...github, id: 'a3', host: 'gitlab.com', sshKeyPath: undefined };
  const second: Account = { ...github, id: 'a4', sshKeyPath: '~/.ssh/gh2' };
  assert.strictEqual(
    renderHostBlocks([tugraz, github, noKey, second], 'C:\\Users\\me'),
    [
      'Host gitlab-teaching.tugraz.at',
      '  IdentityFile "C:/Users/me/.ssh/null-accounts/tugraz_ed25519"',
      '  IdentitiesOnly yes',
      '',
      'Host github.com',
      '  IdentityFile "C:/Users/me/.ssh/gh"',
      '  IdentityFile "C:/Users/me/.ssh/gh2"',
      '  IdentitiesOnly yes',
      '',
    ].join('\n'),
  );
});

test('a port is dropped from the host; a key or host that could inject a directive is skipped', () => {
  const ported: Account = { ...tugraz, host: 'git.example.org:8443' };
  assert.match(renderHostBlocks([ported], '/h'), /^Host git\.example\.org\n/);
  assert.strictEqual(renderHostBlocks([{ ...tugraz, sshKeyPath: '/k"\n  ProxyCommand evil' }], '/h'), '');
  assert.strictEqual(renderHostBlocks([{ ...tugraz, host: '*' }], '/h'), '');
});

test('the Include goes first, is added once, and comes out again leaving the rest untouched', () => {
  const user = 'Host work\n  User git\n';
  const added = withInclude(user);
  assert.ok(added.startsWith('# Null IDE account keys'));
  assert.ok(added.endsWith(user));
  assert.strictEqual(withInclude(added), added);
  assert.strictEqual(withoutInclude(added), user);
  assert.strictEqual(withoutInclude(withInclude('')), '');
  const crlf = 'Host work\r\n  User git\r\n';
  assert.strictEqual(withoutInclude(withInclude(crlf)), crlf);
});

test('sync creates both files, leaves an existing config intact, and cleans up when the last key goes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'null-ssh-'));
  try {
    const userFile = path.join(home, '.ssh', 'config');
    const managed = path.join(home, '.ssh', 'null-accounts', 'config');
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, 'Host work\n  User git\n');

    await syncSshConfig([tugraz], home);
    assert.ok(fs.readFileSync(managed, 'utf8').includes('Host gitlab-teaching.tugraz.at'));
    assert.ok(fs.readFileSync(userFile, 'utf8').includes('Include null-accounts/config'));
    assert.ok(fs.readFileSync(userFile, 'utf8').endsWith('Host work\n  User git\n'));

    await syncSshConfig([tugraz], home); // idempotent
    assert.strictEqual(fs.readFileSync(userFile, 'utf8').split('Include null-accounts/config').length, 2);

    await syncSshConfig([], home);
    assert.ok(!fs.existsSync(managed));
    assert.strictEqual(fs.readFileSync(userFile, 'utf8'), 'Host work\n  User git\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('with no keys and no ssh config, sync creates nothing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'null-ssh-'));
  try {
    await syncSshConfig([], home);
    assert.deepStrictEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
