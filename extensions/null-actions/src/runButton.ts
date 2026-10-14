'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig, OnBusy } from './buttonConfig';
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
  const run = () => registry.dispatch(button.id, button.label, command, { cwd, focus: button.focus, problemMatcher: button.problemMatcher });

  if (!registry.isBusy(button.id)) {
    await run();
    return;
  }

  // Still running: typing the command again would feed the live process's stdin.
  const choice = button.onBusy === 'ask' ? await askWhatToDo(button.label) : button.onBusy;
  if (choice === 'restart') {
    await registry.interrupt(button.id);
    await run();
  } else if (choice === 'show') {
    registry.show(button.id);
  } else if (choice === 'run') {
    await run();
  }
}

async function askWhatToDo(label: string): Promise<Exclude<OnBusy, 'ask'> | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(debug-restart) Restart', detail: 'Stop it with Ctrl+C, then run it again', value: 'restart' as const },
      { label: '$(terminal) Show terminal', detail: 'Leave it running and look at its output', value: 'show' as const },
      { label: '$(warning) Run anyway', detail: 'Type the command into the running process', value: 'run' as const },
    ],
    { title: `"${label}" is still running` },
  );
  return picked?.value;
}
