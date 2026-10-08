'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullActivityApi } from '../../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('null-activity', () => {
  test('activates, exports the API and registers the privacy commands', async () => {
    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    assert.strictEqual(typeof api.getIntervals, 'function');
    assert.strictEqual('deleteAll' in api, false, 'deletion must not be part of the public API');
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null-activity.showTrackedData', 'null-activity.deleteRange', 'null-activity.deleteAll']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
  });

  test('editing a file records an interval that the tracked-data report reflects', async function () {
    this.timeout(30_000);
    if (!vscode.window.state.focused) this.skip(); // heartbeats only count while the window is focused

    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    const file = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'activity-spec.txt');
    fs.writeFileSync(file, '');

    const before = Date.now();
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'hello\n'));
    await sleep(200);
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'world\n'));

    const mine = api
      .getIntervals({ from: before - 60_000, to: Date.now() + 60_000 })
      .filter((i) => i.file === 'activity-spec.txt');
    assert.ok(mine.length > 0, 'no interval recorded for the edited file');
    assert.ok(mine.every((i) => i.end > i.start));
    assert.strictEqual(mine[0].language, 'plaintext');
    assert.ok(mine.reduce((n, i) => n + i.linesAdded, 0) >= 2, 'expected the two inserted lines to be counted');

    await vscode.commands.executeCommand('null-activity.showTrackedData');
    const doc = vscode.window.activeTextEditor!.document;
    assert.strictEqual(doc.uri.scheme, 'null-activity');
    assert.ok(doc.getText().includes('Totals by month'));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
