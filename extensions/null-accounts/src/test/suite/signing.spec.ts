'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullAccountsApi } from '../../api';
import { Account, NewAccount } from '../../types';
import { git, waitFor } from './helpers';

suite('null-accounts commit signing', () => {
  test('an account that signs makes git sign the commits in a bound repo, and unbinding takes it back', async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.activate();
    const repo = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(repo, 'the run opens a temp workspace folder');

    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-accounts-spec-key-'));
    const keyFile = path.join(keyDir, 'id_spec');
    try {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'sign-user@example.test', '-f', keyFile, '-q']);
      execFileSync('git', ['init', '-q'], { cwd: repo });

      const account: NewAccount = {
        provider: 'gitlab', host: 'git.sign.test', username: 'sign-user', email: 'sign-user@example.test',
        authMethod: 'ssh', sshKeyPath: keyFile, signCommits: true,
      };
      const added = await vscode.commands.executeCommand<Account>('null-accounts.test.addAccount', account);
      await vscode.commands.executeCommand('null-accounts.bindFolderToAccount', added.id);
      await waitFor('signing to be written into the repo', () =>
        git(repo, 'config', '--local', 'gpg.format') === 'ssh'
        && git(repo, 'config', '--local', 'commit.gpgsign') === 'true'
        && git(repo, 'config', '--local', 'user.signingkey') === keyFile.replace(/\\/g, '/'));

      // Plain `git commit`, as the editor's Source Control view or a terminal would run it.
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'signed by the integration spec'], { cwd: repo });
      assert.match(
        execFileSync('git', ['cat-file', '-p', 'HEAD'], { cwd: repo, encoding: 'utf8' }),
        /gpgsig -----BEGIN SSH SIGNATURE-----/,
      );

      await vscode.commands.executeCommand('null-accounts.test.removeAccount', added.id);
      await waitFor('signing to be taken back out of the repo', () =>
        git(repo, 'config', '--local', 'commit.gpgsign') === '' && git(repo, 'config', '--local', 'gpg.format') === '');
    } finally {
      fs.rmSync(keyDir, { recursive: true, force: true });
    }
  });
});
