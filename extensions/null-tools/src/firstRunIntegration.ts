'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FirstRunHost, installAll, runFirstRun } from './firstRun';

const INSTALL_TIMEOUT_MS = 120_000;

export function registerFirstRunFeature(context: vscode.ExtensionContext): void {
  const appData = process.env.APPDATA;
  if (!appData) { return; }
  const file = path.join(appData, 'Null', 'null-setup', 'first-run.json');
  const output = vscode.window.createOutputChannel('Null Setup');
  context.subscriptions.push(output);

  const host: FirstRunHost = {
    read() {
      try { return fs.readFileSync(file, 'utf8'); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { output.appendLine(`cannot read ${file}: ${(err as Error).message}`); }
        return undefined;
      }
    },
    remove() {
      try { fs.rmSync(file, { force: true }); } // force: another window may have deleted it already
      catch (err) { output.appendLine(`cannot delete ${file}: ${(err as Error).message}`); }
    },
    // globalValue, not get(): a default from product.json / null-theme is not the user's choice, and false/0/"" are values.
    hasUserValue: key => vscode.workspace.getConfiguration().inspect(key)?.globalValue !== undefined,
    setSetting: async (key, value) => { await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global); },
    installExtension: async id => { await vscode.commands.executeCommand('workbench.extensions.installExtension', id); },
    log: m => output.appendLine(m),
  };

  const notifyFailed = (ids: string[]): void => {
    if (ids.length === 0) { return; }
    const n = ids.length;
    void vscode.window
      .showWarningMessage(`${n} extension${n === 1 ? '' : 's'} chosen during setup could not be installed.`, 'Retry')
      .then(async choice => { if (choice === 'Retry') { notifyFailed(await installAll(host, ids, INSTALL_TIMEOUT_MS)); } });
  };

  runFirstRun(host, INSTALL_TIMEOUT_MS)
    .then(result => notifyFailed(result?.failedExtensions ?? []))
    .catch(err => output.appendLine(`first run failed: ${(err as Error).message}`));
}
