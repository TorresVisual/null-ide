'use strict';

import * as vscode from 'vscode';
import { AgentsViewProvider } from './agentsPanel';

export class NullCodeActionsProvider implements vscode.CodeActionProvider {
  constructor(private readonly _agents: AgentsViewProvider) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const diag = context.diagnostics[0];
    if (!diag) return [];

    const action = new vscode.CodeAction('Fix with AI (null)', vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diag];
    action.command = {
      command: 'null._fixWithAI', title: 'Fix with AI (null)', arguments: [document, diag],
    };
    return [action];
  }
}
