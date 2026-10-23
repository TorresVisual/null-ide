'use strict';

import * as vscode from 'vscode';

// A focused webview (the settings panel) has no activeTextEditor, so remember the
// folder of the last file the user was in.
let lastSeen: vscode.Uri | undefined;

function remember(editor: vscode.TextEditor | undefined): void {
  const uri = editor?.document.uri;
  // Files outside every workspace folder (scratch buffers, settings.json) must not erase the memory.
  if (uri && vscode.workspace.getWorkspaceFolder(uri)) { lastSeen = uri; }
}

export function trackActiveEditor(context: vscode.ExtensionContext): void {
  remember(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(remember));
}

/** Folder of the active file, else of the last workspace file seen, else the first folder. */
export function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri ?? lastSeen;
  return (uri && vscode.workspace.getWorkspaceFolder(uri)) ?? vscode.workspace.workspaceFolders?.[0];
}
