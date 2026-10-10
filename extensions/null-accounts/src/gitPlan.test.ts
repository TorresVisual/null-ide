'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { credentialFor, planFor, sshKeyFile } from './gitPlan';
import { Account } from './types';

const github: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
};

test('a token account gets its identity, a host-scoped credential username, and a credential-store entry', () => {
  assert.deepStrictEqual(planFor(github, '/home/me'), {
    config: [
      { key: 'user.name', value: 'octocat' },
      { key: 'user.email', value: 'octo@example.com' },
      { key: 'credential.https://github.com.username', value: 'octocat' },
    ],
    credential: { host: 'github.com', username: 'octocat' },
  });
});

test('a self-hosted host keeps its port in the credential key and target', () => {
  const gitlab: Account = { ...github, provider: 'gitlab', host: 'git.example.org:8443', username: 'eve', authMethod: 'https' };
  const plan = planFor(gitlab, '/home/me');
  assert.ok(plan.config.some(e => e.key === 'credential.https://git.example.org:8443.username' && e.value === 'eve'));
  assert.deepStrictEqual(plan.credential, { host: 'git.example.org:8443', username: 'eve' });
});

test('an SSH account sets core.sshCommand with the key in single quotes and no credential entry', () => {
  const ssh: Account = { ...github, authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\id work' };
  const plan = planFor(ssh, 'C:\\Users\\me');
  assert.deepStrictEqual(plan.config.at(-1), {
    key: 'core.sshCommand', value: `ssh -i 'C:/Users/me/.ssh/id work' -o IdentitiesOnly=yes`,
  });
  assert.strictEqual(plan.credential, undefined);
  assert.strictEqual(credentialFor(ssh), undefined);
});

test('~ in an SSH key path expands to the home directory, and a quote in the path cannot end the quoting', () => {
  const ssh: Account = { ...github, authMethod: 'ssh', sshKeyPath: '~/.ssh/it\'s; rm -rf ~' };
  assert.strictEqual(sshKeyFile(ssh, 'C:\\Users\\me\\'), `C:/Users/me/.ssh/it's; rm -rf ~`);
  assert.strictEqual(planFor(ssh, '/home/me').config.at(-1)?.value, `ssh -i '/home/me/.ssh/it'\\''s; rm -rf ~' -o IdentitiesOnly=yes`);
});

test('an SSH account without a key path plans an empty key, which the caller reports as a missing file', () => {
  assert.strictEqual(sshKeyFile({ ...github, authMethod: 'ssh' }, '/home/me'), '');
});

test('a token account with a key gets core.sshCommand as well as its credential entry', () => {
  const both: Account = { ...github, sshKeyPath: '/k/id' };
  const plan = planFor(both, '/home/me');
  assert.deepStrictEqual(plan.config.map(e => e.key),
    ['user.name', 'user.email', 'core.sshCommand', 'credential.https://github.com.username']);
  assert.deepStrictEqual(plan.credential, { host: 'github.com', username: 'octocat' });
});

test('signCommits adds git SSH-signing settings that point at the private key, with plain separators and no quoting', () => {
  const signer: Account = { ...github, authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\id work', signCommits: true };
  assert.deepStrictEqual(planFor(signer, 'C:\\Users\\me').config.slice(3), [
    { key: 'gpg.format', value: 'ssh' },
    { key: 'user.signingkey', value: 'C:/Users/me/.ssh/id work' },
    { key: 'commit.gpgsign', value: 'true' },
  ]);
});

test('signCommits without a key plans no signing', () => {
  const stale: Account = { ...github, signCommits: true };
  assert.ok(!planFor(stale, '/home/me').config.some(e => e.key === 'commit.gpgsign'));
});

test('user.name is the git name when the account has one, else the username', () => {
  const name = (a: Account): string | undefined => planFor(a, '/home/me').config.find(e => e.key === 'user.name')?.value;
  assert.strictEqual(name({ ...github, gitName: 'Octo Cat' }), 'Octo Cat');
  assert.strictEqual(name(github), 'octocat');
});
