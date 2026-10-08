'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { NullAccountsApi } from '../../api';
import { Account, NewAccount } from '../../types';

// A GitLab access-token account: its token is the raw stored secret, so no provider or network is involved.
const NEW_ACCOUNT: NewAccount = {
  provider: 'gitlab', host: 'gitlab.example.test', username: 'spec-user', email: 'spec-user@example.test', authMethod: 'https',
};
const TOKEN = 'glpat-integration-spec-token';
const CREDENTIAL_KEY = `credential.https://${NEW_ACCOUNT.host}.username`;
const HAND_SET_EMAIL = 'me@work.example';

/** Output of `git <args>` in `cwd`; '' when git exits non-zero (an unset config key). */
function git(cwd: string, ...args: string[]): string {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); } catch { return ''; }
}

/** Wiring runs asynchronously after a bind or a removal, so poll instead of reading once. */
async function waitFor(what: string, done: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (done()) { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

suite('null-accounts git wiring', () => {
  test('binding wires the repo and the credential store; removing the account undoes both', async function () {
    this.timeout(30_000);
    const api = await vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.activate();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(folder, 'the run opens a temp workspace folder');
    const repo = folder.fsPath;
    const credentialsFile = process.env.NULL_ACCOUNTS_SPEC_CREDENTIALS;
    assert.ok(credentialsFile, 'runTest.ts must set NULL_ACCOUNTS_SPEC_CREDENTIALS (else the run could hit the real credential store)');
    const stored = (): string => (fs.existsSync(credentialsFile) ? fs.readFileSync(credentialsFile, 'utf8') : '');

    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', '--local', 'user.email', HAND_SET_EMAIL], { cwd: repo }); // must survive the round trip

    const added = await vscode.commands.executeCommand<Account>('null-accounts.test.addAccount', NEW_ACCOUNT, TOKEN);
    await vscode.commands.executeCommand('null-accounts.bindFolderToAccount', added.id);
    assert.strictEqual(api.getAccountForFolder(folder)?.id, added.id);
    if (process.platform === 'win32') {
      // recent-projects.json and the binding can spell one path differently; the lookup normalises both.
      assert.strictEqual(api.getAccountForFolder(vscode.Uri.file(repo.toUpperCase()))?.id, added.id);
    }

    await waitFor('the account to be written into the repo', () =>
      git(repo, 'config', '--local', 'user.email') === NEW_ACCOUNT.email
      && git(repo, 'config', '--local', 'user.name') === NEW_ACCOUNT.username
      && git(repo, 'config', '--local', CREDENTIAL_KEY) === NEW_ACCOUNT.username);
    assert.strictEqual(git(repo, 'config', '--global', 'user.email'), '', 'the global config must stay untouched');

    await waitFor('the token to reach the credential store', () =>
      stored().includes(`https://${NEW_ACCOUNT.username}:${TOKEN}@${NEW_ACCOUNT.host}`));
    // The call the Issues panel and every other consumer makes.
    assert.strictEqual(await api.getToken(added), TOKEN);

    await vscode.commands.executeCommand('null-accounts.test.removeAccount', added.id);
    await waitFor('the repo to be restored', () =>
      git(repo, 'config', '--local', 'user.email') === HAND_SET_EMAIL
      && git(repo, 'config', '--local', 'user.name') === ''
      && git(repo, 'config', '--local', CREDENTIAL_KEY) === '');
    await waitFor('the credential to be withdrawn', () => !stored().includes(NEW_ACCOUNT.host));
    assert.strictEqual(api.getAccountForFolder(folder), undefined);
    // Leaves the account list empty, as activation.spec.ts expects whatever order the specs run in.
    assert.deepStrictEqual(api.getAccounts(), []);
  });
});
