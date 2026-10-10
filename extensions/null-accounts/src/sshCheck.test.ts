'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { checkSsh, describeSshTest, interpretSshReply, sshCheckArgs } from './sshCheck';

test('GitLab and GitHub greetings are a success that names the user the key belongs to', () => {
  assert.deepStrictEqual(interpretSshReply('Welcome to GitLab, @ada!\n', 'gitlab.uni.example'), {
    ok: true, user: 'ada', message: 'Connected to gitlab.uni.example as ada.',
  });
  const hub = interpretSshReply("Hi ada! You've successfully authenticated, but GitHub does not provide shell access.", 'github.com');
  assert.deepStrictEqual([hub.ok, hub.user], [true, 'ada']);
});

test('the common failures each get a message that says what to do', () => {
  assert.match(interpretSshReply('Host key verification failed.', 'g.example').message, /ssh git@g\.example/);
  assert.match(interpretSshReply('git@g.example: Permission denied (publickey).', 'g.example').message, /did not accept this key/);
  assert.match(interpretSshReply('spawn ssh ENOENT', 'g.example').message, /not found on your PATH/);
  assert.strictEqual(interpretSshReply('ssh: connect to host g.example port 22: Connection timed out', 'g.example').message,
    'ssh: connect to host g.example port 22: Connection timed out');
  assert.strictEqual(interpretSshReply('  \n', 'g.example').message, 'Could not reach g.example over SSH.');
  assert.strictEqual(interpretSshReply('Permission denied', 'g.example').ok, false);
});

test('checkSsh asks ssh to use only this key, never to prompt, and passes the key as one argument', async () => {
  let seen: string[] = [];
  const check = await checkSsh('g.example', 'C:/Users/me/.ssh/id uni', async args => { seen = args; return 'Welcome to GitLab, @ada!'; });
  assert.strictEqual(check.ok, true);
  assert.deepStrictEqual(seen, sshCheckArgs('g.example', 'C:/Users/me/.ssh/id uni'));
  assert.ok(seen.includes('BatchMode=yes') && seen.includes('IdentitiesOnly=yes'));
  assert.strictEqual(seen[seen.indexOf('-i') + 1], 'C:/Users/me/.ssh/id uni');
  assert.strictEqual(seen.at(-1), 'git@g.example');
});

test('describeSshTest: success is informational; a failure or another user\'s key is a warning', () => {
  const ada = { username: 'ada', host: 'g.example' };
  assert.deepStrictEqual(describeSshTest(ada, { ok: true, user: 'Ada', message: 'Connected to g.example as Ada.' }),
    { level: 'info', text: 'Connected to g.example as Ada. Git in projects using ada@g.example will use this key.' });
  assert.deepStrictEqual(describeSshTest(ada, { ok: false, message: 'did not accept this key' }),
    { level: 'warn', text: 'The SSH test for ada@g.example failed: did not accept this key' });
  const other = describeSshTest(ada, { ok: true, user: 'bob', message: 'Connected to g.example as bob.' });
  assert.strictEqual(other.level, 'warn');
  assert.match(other.text, /belongs to bob, not ada/);
});
