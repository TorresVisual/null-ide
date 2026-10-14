'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface Snapshot { open: boolean; rowCount: number; headSha: string | undefined; detailSha: string | undefined }

async function waitFor<T>(read: () => Thenable<T>, done: (value: T) => boolean, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

suite('null-tools commit graph', () => {
  test('opens on a fixture repo, loads its commits with the HEAD marker, and opens a diff for a changed file', async function () {
    this.timeout(60_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.email', 'spec@example.com');
    git('config', 'user.name', 'Spec');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'one');
    git('add', '--', 'a.txt');
    git('commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'two');
    fs.writeFileSync(path.join(folder, 'b.txt'), 'b');
    git('add', '-A');
    git('commit', '-q', '-m', 'second');
    const head = git('rev-parse', 'HEAD');

    await vscode.extensions.getExtension('null.null-tools')!.activate();
    await vscode.commands.executeCommand('git.openRepository', folder);
    await vscode.commands.executeCommand('null.graph.open');

    const loaded = await waitFor(
      () => vscode.commands.executeCommand<Snapshot>('_null.graph.snapshot'),
      (s) => s.rowCount >= 2,
      'the first rows message',
    );
    assert.strictEqual(loaded.rowCount, 2);
    assert.strictEqual(loaded.headSha, head, 'the checked-out branch is marked on the HEAD commit');

    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: head });
    await waitFor(
      () => vscode.commands.executeCommand<Snapshot>('_null.graph.snapshot'),
      (s) => s.detailSha === head,
      'the commit file list',
    );

    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: head, file: 'b.txt' });
    await waitFor(
      async () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputTextDiff),
      (found) => found,
      'a diff editor',
    );
  });

  test('a message the host did not list is ignored instead of opening anything', async function () {
    this.timeout(20_000);
    const before = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: 'f'.repeat(40), file: 'not-listed.txt' });
    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: '--upload-pack=x' });
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, before);
  });
});
