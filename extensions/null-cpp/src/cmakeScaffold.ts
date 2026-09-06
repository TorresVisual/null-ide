import * as vscode from 'vscode';
import * as path from 'node:path';
import { resolveTargetFolder } from './scaffold';
import { validateClassName } from './scaffoldNaming';
import * as toolchainRegistry from './toolchainRegistry';
import { initializeProjectDetection } from './projectDetection';
import { cmakeListsContent, MAIN_CPP_CONTENT, presetsJsonContent } from './cmakeScaffoldContent';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function registerInitCMakeProject(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.cmake.initProject', async (target?: vscode.Uri) => {
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }

      const cmakeListsUri = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');
      const presetsUri = vscode.Uri.joinPath(folderUri, 'CMakePresets.json');
      const hasCMakeLists = await fileExists(cmakeListsUri);
      const hasPresets = await fileExists(presetsUri);

      if (hasCMakeLists && hasPresets) {
        void vscode.window.showInformationMessage(
          'This folder already has CMakeLists.txt and CMakePresets.json.'
        );
        return;
      }

      let openUri: vscode.Uri | undefined;

      if (!hasCMakeLists) {
        const defaultName = path.basename(folderUri.fsPath).replace(/[^A-Za-z0-9_]/g, '_') || 'Project';
        const name = await vscode.window.showInputBox({
          prompt: 'CMake project name',
          value: defaultName,
          validateInput: validateClassName,
        });
        if (!name) {
          return;
        }

        await vscode.workspace.fs.writeFile(cmakeListsUri, Buffer.from(cmakeListsContent(name), 'utf8'));
        openUri = cmakeListsUri;

        const srcDirUri = vscode.Uri.joinPath(folderUri, 'src');
        if (!(await fileExists(srcDirUri))) {
          await vscode.workspace.fs.createDirectory(srcDirUri);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(srcDirUri, 'main.cpp'),
            Buffer.from(MAIN_CPP_CONTENT, 'utf8')
          );
        }
      }

      if (!hasPresets) {
        const toolchains = await toolchainRegistry.refresh();
        if (toolchains.length === 0) {
          void vscode.window.showWarningMessage(
            'No MSVC/Clang/WSL toolchains detected — install one, then run "Null C++: Refresh Toolchains" and re-run this command to generate CMakePresets.json.'
          );
        } else {
          await vscode.workspace.fs.writeFile(presetsUri, Buffer.from(presetsJsonContent(toolchains), 'utf8'));
        }
      }

      const enabled = await initializeProjectDetection();
      await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);

      if (openUri) {
        const doc = await vscode.workspace.openTextDocument(openUri);
        await vscode.window.showTextDocument(doc);
      }
    })
  );
}
