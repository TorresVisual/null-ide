'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

export interface ProjectState {
  projectName?: string;
  projectPath?: string;
  branchName?: string;
  dirtyCount?: number;
}

export function formatProjectBadgeText(state: ProjectState): string {
  if (!state.projectName) {
    return '$(folder) No Project';
  }
  if (state.branchName) {
    const dirtySuffix = (state.dirtyCount && state.dirtyCount > 0) ? '*' : '';
    return `$(folder) ${state.projectName} (${state.branchName}${dirtySuffix})`;
  }
  if (state.dirtyCount && state.dirtyCount > 0) {
    return `$(folder) ${state.projectName}*`;
  }
  return `$(folder) ${state.projectName}`;
}

export function formatProjectTooltip(state: ProjectState): string {
  if (!state.projectName || !state.projectPath) {
    return 'Null IDE: No workspace folder open';
  }
  const lines: string[] = [
    `Project: ${state.projectName}`,
    `Path: ${state.projectPath}`,
  ];
  if (state.branchName) {
    lines.push(`Git Branch: ${state.branchName}`);
  }
  if (state.dirtyCount !== undefined) {
    lines.push(`Modified Files: ${state.dirtyCount}`);
  }
  lines.push('', 'Click to reveal in Explorer');
  return lines.join('\n');
}

export function registerProjectInfoFeature(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem('null.projectInfo', vscode.StatusBarAlignment.Left, 10000);
  item.command = 'workbench.view.explorer';
  context.subscriptions.push(item);

  async function updateStatusBar(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      item.text = formatProjectBadgeText({});
      item.tooltip = formatProjectTooltip({});
      item.show();
      return;
    }

    const primaryFolder = folders[0];
    const projectPath = primaryFolder.uri.fsPath;
    const projectName = primaryFolder.name || path.basename(projectPath);

    let branchName: string | undefined;
    let dirtyCount: number | undefined;

    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (gitExt) {
        const gitApi = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate())?.getAPI(1);
        if (gitApi && gitApi.repositories) {
          const repo = gitApi.repositories.find((r: any) => r.rootUri.fsPath === projectPath) || gitApi.repositories[0];
          if (repo && repo.state) {
            branchName = repo.state.HEAD?.name;
            const wt = repo.state.workingTreeChanges || [];
            const idx = repo.state.indexChanges || [];
            dirtyCount = wt.length + idx.length;
          }
        }
      }
    } catch {
      // Fall back safely if Git API is unavailable
    }

    const state: ProjectState = {
      projectName,
      projectPath,
      branchName,
      dirtyCount,
    };

    item.text = formatProjectBadgeText(state);
    item.tooltip = formatProjectTooltip(state);
    item.show();
  }

  // Initial update
  updateStatusBar();

  // Listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar()),
    vscode.workspace.onDidSaveTextDocument(() => updateStatusBar()),
  );

  // Subscribe to Git state changes if available
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt) {
      const setupGitListeners = (gitApi: any) => {
        if (!gitApi) { return; }
        for (const repo of gitApi.repositories || []) {
          if (repo.state && typeof repo.state.onDidChange === 'function') {
            context.subscriptions.push(repo.state.onDidChange(() => updateStatusBar()));
          }
        }
        if (typeof gitApi.onDidOpenRepository === 'function') {
          context.subscriptions.push(gitApi.onDidOpenRepository((repo: any) => {
            updateStatusBar();
            if (repo.state && typeof repo.state.onDidChange === 'function') {
              context.subscriptions.push(repo.state.onDidChange(() => updateStatusBar()));
            }
          }));
        }
      };

      if (gitExt.isActive) {
        setupGitListeners(gitExt.exports.getAPI(1));
      } else {
        Promise.resolve(gitExt.activate()).then(() => {
          setupGitListeners(gitExt.exports.getAPI(1));
        }).catch(() => {});
      }
    }
  } catch {
    // Ignore Git listener errors
  }
}
