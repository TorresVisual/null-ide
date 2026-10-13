'use strict';

import * as vscode from 'vscode';
import { collectFeatures, Feature, FeatureCategory } from './featureRegistry';

type Node = FeatureCategory | Feature;

function isCategory(node: Node): node is FeatureCategory {
  return 'features' in node;
}

export class FeaturesTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private categories: FeatureCategory[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor() {
    this.reload();
  }

  reload(): void {
    this.categories = collectFeatures(
      vscode.extensions.all.map(e => ({ extensionId: e.id, packageJSON: e.packageJSON })),
      message => console.warn(`[null-workspace] ${message}`),
    );
    this.changed.fire();
  }

  getChildren(element?: Node): Node[] {
    if (!element) { return this.categories; }
    return isCategory(element) ? element.features : [];
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (isCategory(element)) {
      const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `category/${element.id}`;
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.key;
    item.description = element.description;
    item.tooltip = element.description ? `${element.label} — ${element.description}` : element.label;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = { command: element.command, title: element.label };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function registerFeaturesView(context: vscode.ExtensionContext): void {
  const provider = new FeaturesTreeProvider();
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider('null.featuresView', provider),
    vscode.extensions.onDidChange(() => provider.reload()),
  );
}
