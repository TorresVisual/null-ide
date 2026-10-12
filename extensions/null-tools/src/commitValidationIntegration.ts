'use strict';

import * as vscode from 'vscode';
import { validateCommitMessage } from './commitValidation';

type Mode = 'off' | 'warn' | 'strict';

const mode = (): Mode => vscode.workspace.getConfiguration('null').get<Mode>('commitMessage.validation', 'warn');

/**
 * Squiggles on the Source Control commit box (its documents use the `vscode-scm` scheme, like git's own
 * length checks), plus `null.commitMessage.check`, which patch 008 calls from git's commit path so that
 * `strict` can block the commit button.
 */
export function registerCommitValidationFeature(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('null-commit-message');

  const refresh = (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'vscode-scm') return;
    const m = mode();
    const problem = m === 'off' ? undefined : validateCommitMessage(doc.getText());
    diagnostics.set(doc.uri, problem ? [new vscode.Diagnostic(
      doc.lineAt(0).range, problem,
      m === 'strict' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    )] : []);
  };

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null.commitMessage.validation')) vscode.workspace.textDocuments.forEach(refresh);
    }),
    // Returns the reason to refuse the commit, or undefined to let it through.
    vscode.commands.registerCommand('null.commitMessage.check', (message: string): string | undefined => {
      if (mode() !== 'strict') return undefined;
      const problem = validateCommitMessage(message);
      return problem && `Commit blocked: not a Conventional Commit. ${problem}`;
    }),
  );
  vscode.workspace.textDocuments.forEach(refresh);
}
