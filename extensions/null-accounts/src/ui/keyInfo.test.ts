'use strict';

import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { Account } from '../types';
import { describeKeys } from './keyInfo';

const home = path.resolve('/home/me');
const managedKey = path.join(home, '.ssh', 'null-accounts', 'gh_ed25519');
const managedFile = managedKey.replace(/\\/g, '/'); // the form describeKeys hands its callbacks (sshKeyFile uses '/')
const base: Account = { id: 'a1', provider: 'github', host: 'github.com', username: 'a', email: 'a@e.com', authMethod: 'oauth' };

test('only accounts with a key get a row; it says whether the file exists, who made it and what it is', async () => {
  const asked: string[] = [];
  const rows = await describeKeys(
    [
      base,
      { ...base, id: 'a2', sshKeyPath: managedKey, signCommits: true },
      { ...base, id: 'a3', authMethod: 'ssh', sshKeyPath: '/elsewhere/id_ed25519' },
    ],
    { home, exists: f => f === managedFile, fingerprintOf: async f => { asked.push(f); return 'SHA256:abc'; } },
  );
  assert.deepStrictEqual([...rows.keys()], ['a2', 'a3']);
  assert.deepStrictEqual(rows.get('a2'), {
    path: managedKey, exists: true, managed: true, fingerprint: 'SHA256:abc', signCommits: true, removable: true,
  });
  assert.deepStrictEqual(rows.get('a3'), {
    path: '/elsewhere/id_ed25519', exists: false, managed: false, signCommits: false, removable: false,
  });
  assert.deepStrictEqual(asked, [managedFile], 'a missing file is never fingerprinted');
});

test('a fingerprint that cannot be read leaves the row without one instead of failing the panel', async () => {
  const rows = await describeKeys(
    [{ ...base, sshKeyPath: managedKey }],
    { home, exists: () => true, fingerprintOf: async () => { throw new Error('boom'); } },
  );
  assert.strictEqual(rows.get('a1')?.exists, true);
  assert.ok(!('fingerprint' in (rows.get('a1') ?? {})));
});
