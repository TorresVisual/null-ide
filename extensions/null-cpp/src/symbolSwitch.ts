import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName } from './symbolCache';

export function registerSwitchSourceHeader(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.switchSourceHeader', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCppDocument(editor.document)) {
        return;
      }

      const enclosing = await findEnclosing(editor.document, editor.selection.active);
      const result = await switchSourceHeader(editor.document.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      const counterpartEditor = await vscode.window.showTextDocument(counterpartDoc);

      if (!enclosing) {
        return;
      }
      const match = await findByQualifiedName(counterpartDoc, enclosing.qualifiedName);
      if (!match) {
        return;
      }

      const range = new vscode.Range(
        new vscode.Position(match.range.start.line, match.range.start.character),
        new vscode.Position(match.range.end.line, match.range.end.character)
      );
      counterpartEditor.selection = new vscode.Selection(range.start, range.start);
      counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    })
  );
}
