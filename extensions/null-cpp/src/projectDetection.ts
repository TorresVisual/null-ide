import * as vscode from 'vscode';
import { scanDirectoryForCppProject } from './projectDetectionScan';

let enabled = false;

function getOverride(): 'auto' | 'always' | 'never' {
  return vscode.workspace.getConfiguration('null-cpp').get<'auto' | 'always' | 'never'>(
    'projectDetection.override',
    'auto'
  );
}

function scanWorkspace(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    // A file opened directly (without opening its containing folder) has no
    // workspace folder, but it is still a valid C/C++ editing context.
    const languageId = vscode.window.activeTextEditor?.document.languageId;
    return languageId === 'c' || languageId === 'cpp';
  }
  return folders.some(folder => scanDirectoryForCppProject(folder.uri.fsPath));
}

export async function refreshProjectDetection(): Promise<boolean> {
  const override = getOverride();
  if (override === 'always') {
    enabled = true;
  } else if (override === 'never') {
    enabled = false;
  } else {
    enabled = scanWorkspace();
  }
  return enabled;
}

export const initializeProjectDetection = refreshProjectDetection;

export function isEnabled(): boolean {
  return enabled;
}
