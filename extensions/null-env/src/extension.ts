import * as vscode from 'vscode';
import type { NullEnvApi } from './api';
import { registerCommands } from './commands';
import { detectProjects } from './detect';
import { EnvState } from './envState';
import { ensureDebugType } from './fix';
import { findClangFormatPath, findExecutable, findRustfmtPath } from './probe';
import { vscodeProbes } from './probes';
import { registerStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): NullEnvApi {
  const state = new EnvState(vscodeProbes, context.workspaceState);
  context.subscriptions.push(
    state,
    vscode.workspace.onDidChangeWorkspaceFolders(() => state.refresh()),
    vscode.extensions.onDidChange(() => state.refresh()),
  );
  registerCommands(context, state);
  registerStatusBar(context, state);
  state.refresh();

  return {
    getFindings: () => state.get(),
    onDidChange: state.onDidChange,
    detectProjects: folderPath => detectProjects(folderPath),
    findExecutable: name => findExecutable(name),
    findRustfmtPath,
    findClangFormatPath,
    ensureDebugType,
  };
}

export function deactivate(): void {}
