import * as vscode from 'vscode';
import * as path from 'node:path';
import { resolveTargetFolder } from './scaffold';
import { validateClassName } from './scaffoldNaming';
import { MAIN_CPP_CONTENT } from './cmakeScaffoldContent';
import { makefileContent } from './makeScaffoldContent';
import { initializeProjectDetection } from './projectDetection';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function registerInitMakeProject(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.make.initProject', async (target?: vscode.Uri) => {
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }

      const makefileUri = vscode.Uri.joinPath(folderUri, 'Makefile');
      if (await fileExists(makefileUri)) {
        void vscode.window.showInformationMessage('This folder already has a Makefile.');
        return;
      }

      const defaultName = path.basename(folderUri.fsPath).replace(/[^A-Za-z0-9_]/g, '_') || 'Project';
      const name = await vscode.window.showInputBox({
        prompt: 'Makefile project name',
        value: defaultName,
        validateInput: validateClassName,
      });
      if (!name) {
        return;
      }

      await vscode.workspace.fs.writeFile(makefileUri, Buffer.from(makefileContent(name), 'utf8'));

      const srcDirUri = vscode.Uri.joinPath(folderUri, 'src');
      if (!(await fileExists(srcDirUri))) {
        await vscode.workspace.fs.createDirectory(srcDirUri);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(srcDirUri, 'main.cpp'),
          Buffer.from(MAIN_CPP_CONTENT, 'utf8')
        );
      }

      const enabled = await initializeProjectDetection();
      await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);

      const doc = await vscode.workspace.openTextDocument(makefileUri);
      await vscode.window.showTextDocument(doc);
    })
  );
}
