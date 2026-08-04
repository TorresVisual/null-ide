import * as vscode from 'vscode';

const BUILD_CONFIG_GLOB = '**/{CMakeLists.txt,compile_commands.json,.clangd}';
const SOURCE_FILE_GLOB = '**/*.{c,cpp,cc,cxx,h,hpp,hh,hxx}';
const EXCLUDE_GLOB = '**/node_modules/**';

let enabled = false;

function getOverride(): 'auto' | 'always' | 'never' {
  return vscode.workspace.getConfiguration('null-cpp').get<'auto' | 'always' | 'never'>(
    'projectDetection.override',
    'auto'
  );
}

async function hasAnyMatch(glob: string): Promise<boolean> {
  const matches = await vscode.workspace.findFiles(glob, EXCLUDE_GLOB, 1);
  return matches.length > 0;
}

async function scanWorkspace(): Promise<boolean> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return false;
  }
  if (await hasAnyMatch(BUILD_CONFIG_GLOB)) {
    return true;
  }
  return hasAnyMatch(SOURCE_FILE_GLOB);
}

export async function initializeProjectDetection(): Promise<boolean> {
  const override = getOverride();
  if (override === 'always') {
    enabled = true;
  } else if (override === 'never') {
    enabled = false;
  } else {
    enabled = await scanWorkspace();
  }
  return enabled;
}

export function isEnabled(): boolean {
  return enabled;
}
