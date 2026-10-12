/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getReportHtml } from './reportHtml';
import { buildViewModel, parseWebviewMessage } from './reportModel';
import { ReportStore } from './reportStore';
import { Report } from './types';

const VIEW_TYPE = 'null-startup.report';
const BASELINE_KEY = 'null-startup.report.baseline';

/** Owns the single, reused report tab. All data logic lives in reportModel.ts. */
export class ReportPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private selectedId: string | undefined;
  private baseline: BaselineKind;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReportStore,
    private readonly slowMs: () => number,
  ) {
    const saved = context.workspaceState.get<unknown>(BASELINE_KEY);
    this.baseline = saved === 'median' || saved === 'none' ? saved : 'previous';
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Startup Performance', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [lib] });
    this.panel = panel;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getReportHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('report.js'), asset('report.css'));
    this.disposables.push(
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposables.splice(0).forEach((d) => d.dispose());
      }),
    );
  }

  /** Re-reads the history and pushes it if the tab is open. */
  refresh(): void {
    if (this.panel) void this.push();
  }

  /** The report the tab shows, or the newest one when the tab was never used. */
  async selectedReport(): Promise<Report | undefined> {
    const all = await this.store.list();
    return all.find((r) => r.id === this.selectedId) ?? all[0];
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async push(): Promise<void> {
    const history = await this.store.list();
    const message: HostToWebview = { type: 'model', model: buildViewModel(history, { selectedId: this.selectedId, baseline: this.baseline, slowMs: this.slowMs() }) };
    void this.panel?.webview.postMessage(message);
  }

  private onMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        void this.push();
        break;
      case 'select':
        this.selectedId = message.reportId;
        void this.push();
        break;
      case 'setBaseline':
        this.baseline = message.baseline;
        void this.context.workspaceState.update(BASELINE_KEY, message.baseline);
        void this.push();
        break;
      case 'copy':
        void vscode.commands.executeCommand('null-startup.copyReport');
        break;
      case 'export':
        void vscode.commands.executeCommand('null-startup.exportReport');
        break;
    }
  }
}
