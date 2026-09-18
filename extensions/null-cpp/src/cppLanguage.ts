import * as vscode from 'vscode';

export function isCppDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'cpp' || doc.languageId === 'c';
}
