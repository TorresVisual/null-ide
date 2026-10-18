'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import { spawn } from 'child_process';
import { findInstall } from './updater';

/** `Null: Setup`: the installer window on its Modify page, pre-filled from the install's saved choices. */
export function registerSetupFeature(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('null.setup.open', () => {
    const install = findInstall(context);
    if (!install) {
      void vscode.window.showInformationMessage('Null: Setup needs an installed Null IDE; setup\\null-setup.exe was not found next to this one.');
      return;
    }
    // Keep in step with the args.rs test `the_arguments_null_tools_sends_for_null_setup_parse`.
    // argv array, no shell: a folder with spaces stays one argument. cwd must not be inside the install, or a repair cannot rename it.
    const child = spawn(install.setupExe, ['wizard', '--install-dir', install.installDir, '--intent', 'modify'], {
      detached: true,
      stdio: 'ignore',
      cwd: os.tmpdir(),
    });
    child.once('error', err => void vscode.window.showErrorMessage(`Null: could not start Null Setup: ${err.message}`));
    child.unref();
  }));
}
