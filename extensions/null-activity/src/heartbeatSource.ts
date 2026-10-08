'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { lineDelta } from './tracker';

const TRACKED_SCHEMES = new Set(['file', 'untitled']);

const isTracked = (doc: vscode.TextDocument | undefined): doc is vscode.TextDocument =>
  !!doc && TRACKED_SCHEMES.has(doc.uri.scheme);

function contextOf(doc: vscode.TextDocument | undefined): { file?: string; language: string; workspace?: string } {
  const folder = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) ?? vscode.workspace.workspaceFolders?.[0];
  const workspace = folder?.uri.fsPath;
  const language = doc?.languageId ?? '';
  if (doc?.uri.scheme !== 'file') return { language, workspace };
  const rel = folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath) : '';
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { file: (inside ? rel : path.basename(doc.uri.fsPath)).replace(/\\/g, '/'), language, workspace };
}

/**
 * Turns VS Code events into heartbeats. The stable API exposes no terminal keystrokes, so terminal
 * activity is shell-integration command start/end plus active-terminal changes. Only edits to the
 * active editor's document count, so background refactors do not switch the tracked file.
 */
export function startHeartbeatSource(service: ActivityService): vscode.Disposable {
  const send = (
    doc: vscode.TextDocument | undefined,
    extra: { isWrite?: boolean; linesAdded?: number; linesRemoved?: number } = {},
  ): void =>
    service.recordActivity({ ts: Date.now(), ...contextOf(doc), isWrite: false, linesAdded: 0, linesRemoved: 0, ...extra });
  const active = () => vscode.window.activeTextEditor?.document;

  return vscode.Disposable.from(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0 && e.document === active() && isTracked(e.document)) {
        send(e.document, lineDelta(e.contentChanges));
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (isTracked(e.textEditor.document)) send(e.textEditor.document);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (isTracked(e.textEditor.document)) send(e.textEditor.document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isTracked(editor?.document)) send(editor!.document);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isTracked(doc)) send(doc, { isWrite: true });
    }),
    vscode.window.onDidChangeActiveTerminal(() => send(undefined)),
    vscode.window.onDidStartTerminalShellExecution(() => send(undefined)),
    vscode.window.onDidEndTerminalShellExecution(() => send(undefined)),
    vscode.debug.onDidStartDebugSession(() => send(active())),
    vscode.debug.onDidTerminateDebugSession(() => send(active())),
    vscode.window.onDidChangeWindowState((state) => service.setFocused(state.focused)),
  );
}
