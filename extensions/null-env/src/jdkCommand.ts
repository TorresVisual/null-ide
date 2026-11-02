import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { findExecutable } from './probe';
import { findJdks, runtimeName } from './jdk';

interface Runtime { name: string; path: string; default?: boolean }

const diskFs = {
  listDir: (p: string) => fs.readdirSync(p),
  readFile: (p: string) => fs.readFileSync(p, 'utf8'),
  isFile: (p: string) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  },
};

/** Pick the JDK the Java language server and debugger use for this project (`java.configuration.runtimes`). */
async function selectJdk(): Promise<void> {
  const javac = findExecutable('javac');
  const jdks = findJdks(diskFs, process.platform, os.homedir(), process.env, javac ? [path.dirname(path.dirname(javac))] : []);
  if (jdks.length === 0) {
    void vscode.window.showWarningMessage('Null: no JDK found. Install one (e.g. Eclipse Temurin), then run this again.', 'Get a JDK').then(choice => {
      if (choice) { void vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/temurin/releases/')); }
    });
    return;
  }

  const config = vscode.workspace.getConfiguration('java.configuration');
  const current = config.get<Runtime[]>('runtimes', []).find(r => r.default)?.path?.toLowerCase();
  const picked = await vscode.window.showQuickPick(
    jdks.map(j => ({
      label: `$(coffee) ${j.major > 0 ? `Java ${j.major}` : 'Java'}`,
      description: [j.version, j.home.toLowerCase() === current ? 'current' : ''].filter(Boolean).join(' · '),
      detail: j.home,
      jdk: j,
    })),
    { title: 'Null: Select JDK', placeHolder: 'JDK for this project' },
  );
  if (!picked) {
    return;
  }

  const runtime: Runtime = { name: runtimeName(picked.jdk.major), path: picked.jdk.home, default: true };
  const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  // Keep other runtimes the user listed; replace the old default and any entry with the same name.
  const rest = config.get<Runtime[]>('runtimes', []).filter(r => !r.default && r.name !== runtime.name);
  await config.update('runtimes', [...rest, runtime], target);
  void vscode.window.showInformationMessage(`Null: project JDK set to ${runtime.name}.`);
}

export function registerJdkCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('null.java.selectJdk', selectJdk));
}
