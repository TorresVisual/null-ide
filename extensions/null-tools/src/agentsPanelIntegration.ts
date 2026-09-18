'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';
import { AgentBeforeProvider, AgentsViewProvider, loadNodePty } from './agentsPanel';

export function registerAgentsPanelFeature(context: vscode.ExtensionContext): AgentsViewProvider {
  const nodePty        = loadNodePty(context.extensionUri.fsPath);
  const agentsProvider = new AgentsViewProvider(context.extensionUri, nodePty, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.agentsView', agentsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push({ dispose: () => agentsProvider._saveBuffers() });

  const beforeProvider = new AgentBeforeProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(beforeProvider.scheme, beforeProvider),
  );

  // Track whether the active tab is one of our agent diffs and expose context.
  const updateDiffContext = () => {
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    const viewing = active?.input instanceof vscode.TabInputTextDiff &&
      active.input.original.scheme === beforeProvider.scheme;
    vscode.commands.executeCommand('setContext', 'null.viewingProposedDiff', !!viewing);
  };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(updateDiffContext),
    vscode.window.onDidChangeActiveTextEditor(updateDiffContext),
  );

  context.subscriptions.push(vscode.commands.registerCommand('null.acceptProposedDiff', async () => {
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (active) await vscode.window.tabGroups.close(active);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.rejectProposedDiff', async () => {
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(active?.input instanceof vscode.TabInputTextDiff)) return;
    const diskUri = active.input.modified;
    await vscode.window.tabGroups.close(active);
    await vscode.commands.executeCommand('null.revertAgentChange', diskUri);
  }));

  context.subscriptions.push(vscode.commands.registerCommand(
    'null.revertAgentChange',
    async (uri: vscode.Uri) => {
      try {
        await vscode.commands.executeCommand('git.revertFile', uri);
      } catch {
        try { execSync(`git checkout -- "${uri.fsPath}"`, { cwd: path.dirname(uri.fsPath) }); }
        catch (err) { vscode.window.showErrorMessage(`Null: revert failed — ${(err as Error).message}`); }
      }
    },
  ));

  context.subscriptions.push(
    vscode.commands.registerCommand('null.agentsPaste', () => agentsProvider.paste()),
  );

  return agentsProvider;
}
