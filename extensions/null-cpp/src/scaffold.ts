import * as vscode from 'vscode';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetFolder(target: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
  if (target) {
    const stat = await vscode.workspace.fs.stat(target);
    return stat.type === vscode.FileType.Directory ? target : vscode.Uri.joinPath(target, '..');
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('Open a folder to create a new C++ class.');
    return undefined;
  }
  return folders[0].uri;
}

export function registerNewClass(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.newClass', async (target?: vscode.Uri) => {
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'C++ class/file name (no extension)',
        validateInput: validateClassName,
      });
      if (!name) {
        return;
      }

      const headerUri = vscode.Uri.joinPath(folderUri, headerFileName(name));
      const sourceUri = vscode.Uri.joinPath(folderUri, sourceFileName(name));
      if ((await fileExists(headerUri)) || (await fileExists(sourceUri))) {
        void vscode.window.showErrorMessage(
          `${headerFileName(name)} or ${sourceFileName(name)} already exists.`
        );
        return;
      }

      await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent(), 'utf8'));
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent(name), 'utf8'));

      const headerDoc = await vscode.workspace.openTextDocument(headerUri);
      await vscode.window.showTextDocument(headerDoc);
    })
  );
}
