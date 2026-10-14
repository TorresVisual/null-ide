'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const ERROR_FILE = 'src/main.rs';

function rustErrors(): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics().flatMap(([uri, diags]) => (uri.path.endsWith(ERROR_FILE) ? diags : []));
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (cond()) { return; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

suite('null-actions problem matcher', () => {
  test('a button with a matcher fills Problems on failure and clears them on the next clean run', async function () {
    this.timeout(40000);
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const flag = path.join(root, 'fail.flag');
    // Prints what `cargo build` prints for a type error when the flag file exists.
    fs.writeFileSync(path.join(root, 'build.js'), [
      "if (require('fs').existsSync('fail.flag')) {",
      "  console.log('error[E0308]: mismatched types');",
      "  console.log(' --> " + ERROR_FILE + ":2:18');",
      '  process.exit(101);',
      '}',
    ].join('\n'));
    await vscode.workspace.getConfiguration().update('null-actions.buttons', [
      { id: 'pm', label: 'PM', command: 'node build.js', problemMatcher: '$null-rustc', focus: false },
    ], vscode.ConfigurationTarget.Workspace);
    await vscode.extensions.getExtension('null.null-actions')!.activate();

    fs.writeFileSync(flag, '');
    await vscode.commands.executeCommand('null-actions.runButton', 'pm');
    await waitFor(() => rustErrors().length > 0, 'the compiler error to reach Problems');
    const [error] = rustErrors();
    assert.strictEqual(error.message, 'mismatched types');
    assert.strictEqual(error.range.start.line, 1);

    fs.rmSync(flag);
    // For 8 s after a failure the button's click only reveals its terminal (see StatusBarController.RESULT_MS).
    await new Promise(r => setTimeout(r, 8500));
    await vscode.commands.executeCommand('null-actions.runButton', 'pm');
    await waitFor(() => rustErrors().length === 0, 'the error to clear after a clean run');
  });
});
