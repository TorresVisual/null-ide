import * as vscode from 'vscode';
import { registerSwitchSourceHeader } from './symbolSwitch';
import { registerPairedSplit } from './pairedSplit';
import { registerNewClass } from './scaffold';
import { registerInitCMakeProject } from './cmakeScaffold';
import { registerInitMakeProject } from './makeScaffold';
import { initializeProjectDetection, refreshProjectDetection } from './projectDetection';
import { registerCmakeToolbar } from './cmakeToolbar';
import { registerMakeToolbar } from './makeToolbar';
import { registerSingleFileCompile } from './singleFileCompile';
import { getEnvApi } from './envApi';
import { setExecutableFinder } from './toolchainRegistry';

async function syncCppProjectContext(): Promise<boolean> {
  const enabled = await refreshProjectDetection();
  await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);
  return enabled;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setExecutableFinder(name => getEnvApi().findExecutable(name));
  await initializeProjectDetection();
  await syncCppProjectContext();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      void syncCppProjectContext();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void syncCppProjectContext();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('null-cpp.projectDetection.override')) {
        void syncCppProjectContext();
      }
    }),
    vscode.commands.registerCommand('null-cpp.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:null null-cpp')
    ),
    vscode.commands.registerCommand('null-cpp.enableForWorkspace', async () => {
      await vscode.workspace
        .getConfiguration('null-cpp')
        .update('projectDetection.override', 'always', vscode.ConfigurationTarget.Workspace);
      const enabled = await syncCppProjectContext();
      if (enabled) {
        void vscode.window.showInformationMessage('Null C++ is now enabled for this workspace.');
      }
    })
  );

  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
  registerInitCMakeProject(context);
  registerInitMakeProject(context);
  registerCmakeToolbar(context);
  registerMakeToolbar(context);
  registerSingleFileCompile(context);
}

export function deactivate(): void {}
