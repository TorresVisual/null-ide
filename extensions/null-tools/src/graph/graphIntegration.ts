'use strict';

import * as vscode from 'vscode';
import { CommitGraphPanel } from './commitGraphPanel';
import { registerGraphCommands } from './graphCommands';
import { registerEmptyDocument } from './graphDiff';
import { GraphSession } from './graphSession';
import { GraphTreeProvider } from './graphTreeView';

/** Registration only: nothing spawns git until the tab or the tree is shown. */
export function registerGraphFeature(context: vscode.ExtensionContext): void {
  const session = new GraphSession();
  const panel = new CommitGraphPanel(context, session);
  const tree = new GraphTreeProvider(session);
  const view = vscode.window.createTreeView('null.graphView', { treeDataProvider: tree });
  view.onDidChangeVisibility((e) => tree.setVisible(e.visible), undefined, context.subscriptions);
  tree.setVisible(view.visible);

  registerEmptyDocument(context);
  registerGraphCommands(context, session, panel);
  context.subscriptions.push(session, panel, tree, view);
}
