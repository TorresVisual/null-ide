'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig } from './buttonConfig';
import { resolveVariables, VariableContext } from './variableResolver';
import { TerminalRegistry } from './terminalRegistry';

function buildVariableContext(): VariableContext {
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders?.[0];
  const doc = editor?.document;
  const fsPath = doc?.uri.fsPath;

  return {
    workspaceFolder: folder?.uri.fsPath,
    file: fsPath,
    fileBasename: fsPath ? fsPath.split(/[\\/]/).pop() : undefined,
    fileDirname: fsPath ? fsPath.replace(/[\\/][^\\/]*$/, '') : undefined,
    relativeFile: doc ? vscode.workspace.asRelativePath(doc.uri) : undefined,
    selectedText: editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined,
    lineNumber: editor ? String(editor.selection.active.line + 1) : undefined,
    env: process.env,
  };
}

export async function runButton(button: ActionButtonConfig, registry: TerminalRegistry): Promise<void> {
  if (button.saveAll) {
    await vscode.workspace.saveAll();
  }

  const ctx = buildVariableContext();

  if (button.type === 'vscode-command') {
    const args = (button.args ?? []).map(a => (typeof a === 'string' ? resolveVariables(a, ctx) : a));
    await vscode.commands.executeCommand(button.command, ...args);
    return;
  }

  const cwd = button.cwd ? resolveVariables(button.cwd, ctx) : ctx.workspaceFolder;
  const command = resolveVariables(button.command, ctx);
  registry.dispatch(button.id, button.label, command, { cwd, focus: button.focus });
}
