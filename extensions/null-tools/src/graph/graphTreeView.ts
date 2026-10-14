/// <reference path="./protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import { formatAge } from './gitLog';
import { GraphSession } from './graphSession';

export interface GraphTreeElement {
  sha: string;
  subject: string;
  author: string;
  time: number;
  refs: GraphRefLabel[];
}

const TREE_COMMITS = 50;

/** The first 50 commits of the shared listing, loaded only while the view is visible. */
export class GraphTreeProvider implements vscode.TreeDataProvider<GraphTreeElement>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private elements: GraphTreeElement[] = [];
  private lease: vscode.Disposable | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly session: GraphSession) {
    this.subscription = session.onDidChange(() => { if (this.lease) void this.load(); });
  }

  setVisible(visible: boolean): void {
    if (visible && !this.lease) {
      this.lease = this.session.acquire();
      void this.load();
    } else if (!visible && this.lease) {
      this.lease.dispose();
      this.lease = undefined;
    }
  }

  private async load(): Promise<void> {
    const availability = await this.session.availability();
    if (!availability.ok) {
      this.elements = [];
    } else {
      try {
        await this.session.busy.whenIdle();
        const page = await availability.service.loadPage(0, TREE_COMMITS);
        this.elements = page.commits.map((c) => ({ sha: c.sha, subject: c.subject, author: c.author, time: c.time, refs: c.refs }));
        void this.session.prime();
      } catch {
        this.elements = []; // keep the view quiet; the tab shows load errors with a retry
      }
    }
    this.emitter.fire();
  }

  getTreeItem(element: GraphTreeElement): vscode.TreeItem {
    const item = new vscode.TreeItem(element.subject, vscode.TreeItemCollapsibleState.None);
    const badges = element.refs.map((r) => r.name).join(' ');
    item.description = [element.author, formatAge(element.time, Date.now() / 1000), badges].filter(Boolean).join(' · ');
    item.tooltip = `${element.sha}\n${element.author}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'graphCommit';
    item.id = element.sha;
    item.command = { command: 'null.graph.open', title: 'Open Commit Graph', arguments: [element.sha] };
    return item;
  }

  getChildren(): GraphTreeElement[] {
    return this.elements;
  }

  dispose(): void {
    this.lease?.dispose();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
