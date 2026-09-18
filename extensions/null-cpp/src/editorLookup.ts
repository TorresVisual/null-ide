import * as vscode from 'vscode';

export function findVisibleEditor(uriString: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriString);
}
