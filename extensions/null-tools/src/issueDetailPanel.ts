'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { formatIssueAsPrompt } from './github/promptFormat';

type InboundMessage = { type: 'ready' } | { type: 'copyAsPrompt' } | { type: 'openInBrowser' };

export class IssueDetailPanel {
  private static current: IssueDetailPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private issueNumber = 0;

  static async show(extensionUri: vscode.Uri, store: IssuesStore, issueNumber: number): Promise<void> {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.panel.reveal(vscode.ViewColumn.Active);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'null-tools.issueDetail',
        `Issue #${issueNumber}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
        },
      );
      IssueDetailPanel.current = new IssueDetailPanel(panel, extensionUri, store);
    }
    await IssueDetailPanel.current.open(issueNumber);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly store: IssuesStore,
  ) {
    this.panel = panel;
    this.panel.webview.html = this._buildHtml();
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this._handleMessage(msg));
    this.panel.onDidDispose(() => {
      IssueDetailPanel.current = undefined;
    });
  }

  private async open(issueNumber: number): Promise<void> {
    this.issueNumber = issueNumber;
    this.panel.title = `Issue #${issueNumber}`;
    await this._sendDetail();
  }

  private async _sendDetail(): Promise<void> {
    const issue = this.store.getByNumber(this.issueNumber);
    if (!issue) return;
    const comments = await this.store.getComments(this.issueNumber);
    this.panel.webview.postMessage({ type: 'issueDetail', issue, comments });
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this._sendDetail();
        break;
      case 'copyAsPrompt': {
        const issue = this.store.getByNumber(this.issueNumber);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this.panel.webview.postMessage({ type: 'copied' });
        break;
      }
      case 'openInBrowser': {
        const issue = this.store.getByNumber(this.issueNumber);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      }
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.js'),
    );
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:#181818; color:#ccc;
              font:13px/1.6 'Cascadia Code',Consolas,monospace; }
  #detail { max-width:900px; margin:0 auto; padding:24px; }
  h2 { color:#e0e0e0; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  .issue-meta { color:#666; font-size:11px; margin:6px 0; }
  #detail-body { white-space:pre-wrap; margin:16px 0; color:#ccc; }
  .comment { border-top:1px solid #2b2b2b; padding:10px 0; }
  .comment-author { color:#4EC9B0; }
  button.action { background:#0078D4; color:#fff; border:none; padding:6px 12px; border-radius:2px; cursor:pointer; margin-right:6px; font:inherit; }
  button.action:hover { background:#106EBE; }
  #empty { padding:20px; color:#666; }
</style></head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}
