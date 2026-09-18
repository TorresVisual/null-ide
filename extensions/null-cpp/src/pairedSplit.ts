import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';
import { isEnabled } from './projectDetection';
import { findVisibleEditor } from './editorLookup';

const SCROLL_SYNC_DEBOUNCE_MS = 120;

function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('null-cpp').get<T>(key, fallback);
}

function closeTab(uriString: string): void {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriString) {
        void vscode.window.tabGroups.close(tab);
      }
    }
  }
}

async function syncScroll(
  doc: vscode.TextDocument,
  position: vscode.Position,
  counterpartEditor: vscode.TextEditor
): Promise<void> {
  const enclosing = await findEnclosing(doc, position);
  if (!enclosing) {
    return;
  }
  const match = await findByQualifiedName(counterpartEditor.document, enclosing.qualifiedName);
  if (!match) {
    return;
  }
  const range = new vscode.Range(
    new vscode.Position(match.range.start.line, match.range.start.character),
    new vscode.Position(match.range.end.line, match.range.end.character)
  );
  counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerPairedSplit(context: vscode.ExtensionContext): void {
  const registry = new PairRegistry();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!isEnabled() || !getConfig('autoPairSplit.enabled', true) || !isCppDocument(doc)) {
        return;
      }
      const key = doc.uri.toString();
      if (registry.has(key)) {
        return;
      }

      const result = await switchSourceHeader(doc.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const counterpartKey = result.uri.toString();
      const alreadyVisible = findVisibleEditor(counterpartKey) !== undefined;
      registry.record(key, counterpartKey);
      if (alreadyVisible) {
        return;
      }

      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      await vscode.window.showTextDocument(counterpartDoc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      });
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!isEnabled()) {
        return;
      }
      const key = doc.uri.toString();
      const counterpart = registry.getCounterpart(key);
      registry.remove(key);
      invalidate(doc.uri);
      if (counterpart && getConfig('pairedSplit.autoCloseCounterpart', false)) {
        closeTab(counterpart);
      }
    }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!isEnabled() || !getConfig('scrollSync.enabled', true)) {
        return;
      }
      const doc = event.textEditor.document;
      const counterpartKey = registry.getCounterpart(doc.uri.toString());
      if (!counterpartKey) {
        return;
      }
      const counterpartEditor = findVisibleEditor(counterpartKey);
      if (!counterpartEditor) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      const position = event.selections[0].active;
      debounceTimer = setTimeout(() => {
        void syncScroll(doc, position, counterpartEditor);
      }, SCROLL_SYNC_DEBOUNCE_MS);
    })
  );
}
