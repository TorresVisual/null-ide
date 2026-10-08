'use strict';

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { GIT_UNAVAILABLE, GitRun, runGit } from './git';
import { describeSkip, GitWiring } from './gitWiring';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const scratch = mkdtempSync(path.join(tmpdir(), 'null-accounts-wiring-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function makeRepo(): string {
  const dir = path.join(scratch, `repo-${++n}`);
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}
const config = (dir: string, key: string): string | undefined => {
  try { return execFileSync('git', ['config', '--local', '--get', key], { cwd: dir, encoding: 'utf8' }).trim(); } catch { return undefined; }
};

const alice: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob: Account = {
  id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const CRED_ALICE = 'credential.https://github.com.username';

function setup(initial: Array<[string, Account]>, git: GitRun = runGit) {
  const meta = new FakeMeta();
  const accounts = new Map(initial.map(([, a]) => [a.id, a]));
  const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
  const calls: string[][] = [];
  const counting: GitRun = (cwd, args, input) => { calls.push(args); return git(cwd, args, input); };
  const make = () => new GitWiring({
    meta, git: counting, home: '/home/me', exists: existsSync,
    bindings: { entries: () => [...bound.entries()] },
    accounts: { get: id => accounts.get(id) },
  });
  return { meta, accounts, bound, calls, wiring: make(), make };
}

test('binding writes the identity and the credential username into the repo, and nothing outside it', async () => {
  const dir = makeRepo();
  const { wiring } = setup([[dir, alice]]);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.name'), 'alice');
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');
  assert.strictEqual(config(dir, CRED_ALICE), 'alice');
});

test('a second reconcile with nothing changed runs no git at all', async () => {
  const dir = makeRepo();
  const { wiring, calls } = setup([[dir, alice]]);
  await wiring.reconcile();
  calls.length = 0;
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'unchanged' }]);
  assert.deepStrictEqual(calls, []);
});

test('rebinding swaps every value and drops keys the new account does not use', async () => {
  const dir = makeRepo();
  const { wiring, bound, accounts } = setup([[dir, alice]]);
  accounts.set(bob.id, bob);
  await wiring.reconcile();
  bound.set(dir, bob.id);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.email'), 'bob@example.org');
  assert.strictEqual(config(dir, 'credential.https://git.example.org:8443.username'), 'bob');
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
});

test('unbinding restores what the repo had before, and removes what it did not', async () => {
  const dir = makeRepo();
  execFileSync('git', ['config', '--local', 'user.email', 'me@work.example'], { cwd: dir });
  const { wiring, bound } = setup([[dir, alice]]);
  await wiring.reconcile();
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');

  bound.delete(dir);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), 'me@work.example');
  assert.strictEqual(config(dir, 'user.name'), undefined);
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
  assert.deepStrictEqual(await wiring.reconcile(), []); // forgotten: nothing left to visit
});

test('a value the user changed after we wrote it is left alone on unbind', async () => {
  const dir = makeRepo();
  const { wiring, bound } = setup([[dir, alice]]);
  await wiring.reconcile();
  execFileSync('git', ['config', '--local', 'user.email', 'edited@by.hand'], { cwd: dir });
  bound.delete(dir);
  await wiring.reconcile();
  assert.strictEqual(config(dir, 'user.email'), 'edited@by.hand');
  assert.strictEqual(config(dir, 'user.name'), undefined);
});

test('removing the account clears its folders, even after a restart (the record lives in the metadata store)', async () => {
  const dir = makeRepo();
  const { wiring, accounts, meta, make } = setup([[dir, alice]]);
  await wiring.reconcile();
  accounts.delete(alice.id);
  const restarted = make(); // same meta, new instance
  assert.deepStrictEqual(await restarted.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), undefined);
  assert.deepStrictEqual(meta.data.get('null-accounts.gitWiring'), {});
});

test('editing the account email rewrites the repo', async () => {
  const dir = makeRepo();
  const { wiring, accounts } = setup([[dir, alice]]);
  await wiring.reconcile();
  accounts.set(alice.id, { ...alice, email: 'new@example.com' });
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.email'), 'new@example.com');
});

test('a bound folder that is not a repo, or does not exist, is skipped without being mistaken for "git missing"', async () => {
  const plain = path.join(scratch, 'plain');
  mkdirSync(plain);
  const gone = path.join(scratch, 'gone');
  const { wiring } = setup([[plain, alice], [gone, alice]]);
  const outcomes = await wiring.reconcile();
  const byFolder = Object.fromEntries(outcomes.map(o => [o.folder, o]));
  assert.strictEqual(byFolder[plain].status, 'skipped');
  assert.strictEqual((byFolder[plain] as { reason: string }).reason, 'not-a-repo');
  assert.strictEqual((byFolder[gone] as { reason: string }).reason, 'folder-missing');
  assert.strictEqual(describeSkip(byFolder[plain] as never, 'plain'), undefined);
  assert.strictEqual(describeSkip(byFolder[gone] as never, 'gone'), undefined);
});

test('git not being installed skips with a warning and keeps the record so cleanup is retried', async () => {
  const dir = makeRepo();
  let installed = true;
  const flaky: GitRun = (cwd, args, input) =>
    installed ? runGit(cwd, args, input) : Promise.resolve({ code: GIT_UNAVAILABLE, stdout: '', stderr: 'spawn git ENOENT' });
  const { wiring, bound } = setup([[dir, alice]], flaky);
  await wiring.reconcile();

  bound.delete(dir);
  installed = false;
  const [offline] = await wiring.reconcile();
  assert.deepStrictEqual(offline, { folder: dir, status: 'skipped', reason: 'git-missing' });
  assert.match(describeSkip(offline as never, 'repo') ?? '', /git was not found/);
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com'); // untouched

  installed = true;
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), undefined);
});

test('an SSH account writes core.sshCommand; a missing key file changes nothing and names the file', async () => {
  const dir = makeRepo();
  const key = path.join(scratch, 'id_work');
  const ssh: Account = { ...alice, id: 'a3', authMethod: 'ssh', sshKeyPath: key };
  const { wiring, accounts } = setup([[dir, ssh]]);
  const [missing] = await wiring.reconcile();
  assert.deepStrictEqual(missing, { folder: dir, status: 'skipped', reason: 'ssh-key-missing', detail: key.replace(/\\/g, '/') });
  assert.match(describeSkip(missing as never, 'repo') ?? '', /SSH key .*id_work.* was not found/);
  assert.strictEqual(config(dir, 'user.email'), undefined);

  writeFileSync(key, 'not a real key');
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'core.sshCommand'), `ssh -i '${key.replace(/\\/g, '/')}' -o IdentitiesOnly=yes`);
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
  assert.ok(accounts.has('a3'));
});

test('rebinding to an SSH account whose key is missing still removes the previous account from the repo', async () => {
  const dir = makeRepo();
  const ssh: Account = { ...bob, id: 'a3', authMethod: 'ssh', sshKeyPath: path.join(scratch, 'nope') };
  const { wiring, bound, accounts } = setup([[dir, alice]]);
  accounts.set(ssh.id, ssh);
  await wiring.reconcile();
  bound.set(dir, ssh.id);
  const [outcome] = await wiring.reconcile();
  assert.strictEqual((outcome as { reason: string }).reason, 'ssh-key-missing');
  assert.strictEqual(config(dir, 'user.email'), undefined);
});

test('overlapping reconciles are serialised: two rapid calls leave one consistent result', async () => {
  const dir = makeRepo();
  const { wiring } = setup([[dir, alice]]);
  const [first, second] = await Promise.all([wiring.reconcile(), wiring.reconcile()]);
  assert.strictEqual(first[0].status, 'wired');
  assert.strictEqual(second[0].status, 'unchanged');
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');
});
