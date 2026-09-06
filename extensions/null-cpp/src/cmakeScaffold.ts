import * as vscode from 'vscode';
import * as path from 'node:path';
import { resolveTargetFolder } from './scaffold';
import { validateClassName } from './scaffoldNaming';
import * as toolchainRegistry from './toolchainRegistry';
import { initializeProjectDetection } from './projectDetection';
import {
  appendAddSubdirectory,
  cmakeListsContent,
  MAIN_CPP_CONTENT,
  nestedCMakeListsContent,
  presetsJsonContent,
} from './cmakeScaffoldContent';
import { refreshCMakeFileContext } from './cmakeToolbar';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Walks up from folderUri looking for an ancestor CMakeLists.txt, stopping at the workspace root. */
async function findAncestorCMakeLists(folderUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(folderUri)?.uri;
  let dir = folderUri;
  for (;;) {
    const parent = vscode.Uri.joinPath(dir, '..');
    if (parent.fsPath === dir.fsPath) {
      return undefined;
    }
    dir = parent;
    const candidate = vscode.Uri.joinPath(dir, 'CMakeLists.txt');
    if (await fileExists(candidate)) {
      return candidate;
    }
    if (workspaceRoot && dir.fsPath === workspaceRoot.fsPath) {
      return undefined;
    }
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
      const ancestorCMakeLists = hasCMakeLists ? undefined : await findAncestorCMakeLists(folderUri);

      if (!hasCMakeLists && ancestorCMakeLists) {
        const defaultName = path.basename(folderUri.fsPath).replace(/[^A-Za-z0-9_]/g, '_') || 'Module';
        const name = await vscode.window.showInputBox({
          prompt: `CMake library target name (nested under ${path.basename(path.dirname(ancestorCMakeLists.fsPath))})`,
          value: defaultName,
          validateInput: validateClassName,
        });
        if (!name) {
          return;
        }

        await vscode.workspace.fs.writeFile(cmakeListsUri, Buffer.from(nestedCMakeListsContent(name), 'utf8'));
        openUri = cmakeListsUri;

        const parentContent = Buffer.from(await vscode.workspace.fs.readFile(ancestorCMakeLists)).toString('utf8');
        const relativeDir = path.relative(path.dirname(ancestorCMakeLists.fsPath), folderUri.fsPath);
        const updated = appendAddSubdirectory(parentContent, relativeDir);
        if (updated !== parentContent) {
          await vscode.workspace.fs.writeFile(ancestorCMakeLists, Buffer.from(updated, 'utf8'));
        }
      } else if (!hasCMakeLists) {
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

      if (!hasPresets && !ancestorCMakeLists) {
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
      await refreshCMakeFileContext(context);

      if (openUri) {
        const doc = await vscode.workspace.openTextDocument(openUri);
        await vscode.window.showTextDocument(doc);
      }
    })
  );
}
