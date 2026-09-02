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
    return false;
  }
  return folders.some(folder => scanDirectoryForCppProject(folder.uri.fsPath));
}

export async function initializeProjectDetection(): Promise<boolean> {
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

export function isEnabled(): boolean {
  return enabled;
}
