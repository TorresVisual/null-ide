'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { formatIssueAsPrompt } from './github/promptFormat';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { toggleTaskCheckbox } from './github/taskList';
import { loadIssueTemplates } from './github/issueTemplates';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'copyAsPrompt' }
  | { type: 'openInBrowser' }
  | { type: 'setState'; state: 'open' | 'closed' }
  | { type: 'toggleTask'; index: number; checked: boolean }
  | { type: 'saveEdit'; title: string; body: string; labels: string[]; assignees: string[] }
  | { type: 'createBranch' }
  | { type: 'createWorktree' }
  | { type: 'postComment'; body: string }
  | { type: 'editComment'; commentId: number; body: string }
  | { type: 'deleteComment'; commentId: number }
  | { type: 'submitCreate'; title: string; body: string; labels: string[]; assignees: string[] }
  | { type: 'cancelCreate' };

export class IssueDetailPanel {
  private static current: IssueDetailPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private issueNumber = 0;
  private creating = false;
  private onCreated?: () => void;

  static async show(extensionUri: vscode.Uri, store: IssuesStore, issueNumber: number): Promise<void> {
    IssueDetailPanel.open(extensionUri, store);
    await IssueDetailPanel.current!.openIssue(issueNumber);
  }

  static async showCreate(extensionUri: vscode.Uri, store: IssuesStore, onCreated?: () => void): Promise<void> {
    IssueDetailPanel.open(extensionUri, store);
    await IssueDetailPanel.current!.openCreate(onCreated);
  }

  private static open(extensionUri: vscode.Uri, store: IssuesStore): void {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.panel.reveal(vscode.ViewColumn.Active);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'null-tools.issueDetail',
        'Issue',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
        },
      );
      panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
      IssueDetailPanel.current = new IssueDetailPanel(panel, extensionUri, store);
    }
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

  private async openIssue(issueNumber: number): Promise<void> {
    this.creating = false;
    this.issueNumber = issueNumber;
    this.panel.title = `Issue #${issueNumber}`;
    await this._sendDetail();
  }

  private async openCreate(onCreated?: () => void): Promise<void> {
    this.creating = true;
    this.onCreated = onCreated;
    this.panel.title = 'New Issue';
    await this._sendDetail();
  }

  private async _sendDetail(): Promise<void> {
    if (this.creating) {
      let repoLabels, assignableUsers;
      try {
        [repoLabels, assignableUsers] = await Promise.all([
          this.store.getRepoLabels(),
          this.store.getAssignableUsers(),
        ]);
      } catch (err) {
        this.panel.webview.postMessage({ type: 'issueDetailError', message: (err as Error).message });
        return;
      }
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const templates = cwd ? loadIssueTemplates(cwd) : [];
      this.panel.webview.postMessage({
        type: 'issueDetail',
        issue: null, comments: [], timeline: [], repoLabels, assignableUsers, templates,
        viewerLogin: this.store.getViewerLogin(),
      });
      return;
    }
    const issue = this.store.getByNumber(this.issueNumber);
    if (!issue) return;
    let comments, timeline, repoLabels, assignableUsers;
    try {
      [comments, timeline, repoLabels, assignableUsers] = await Promise.all([
        this.store.getComments(this.issueNumber),
        this.store.getTimeline(this.issueNumber),
        this.store.getRepoLabels(),
        this.store.getAssignableUsers(),
      ]);
    } catch (err) {
      this.panel.webview.postMessage({ type: 'issueDetailError', message: (err as Error).message });
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const closedLocally = issue.state === 'open' && !!cwd && getLocallyClosedIssueNumbers(cwd).has(issue.number);
    this.panel.webview.postMessage({
      type: 'issueDetail',
      issue: closedLocally ? { ...issue, closedLocally } : issue,
      comments, timeline, repoLabels, assignableUsers,
      viewerLogin: this.store.getViewerLogin(),
    });
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this._sendDetail();
        break;
      case 'refresh':
        try {
          await this.store.reloadIssue(this.issueNumber);
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to refresh issue: ${(err as Error).message}`);
        }
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
      case 'setState': {
        try {
          await this.store.updateIssue(this.issueNumber, { state: msg.state });
          await this._sendDetail();
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to update issue: ${(err as Error).message}`);
        }
        break;
      }
      case 'toggleTask': {
        const issue = this.store.getByNumber(this.issueNumber);
        const newBody = issue?.body ? toggleTaskCheckbox(issue.body, msg.index, msg.checked) : null;
        if (newBody === null) break;
        try {
          await this.store.updateIssue(this.issueNumber, { body: newBody });
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to update checkbox: ${(err as Error).message}`);
        }
        await this._sendDetail();
        break;
      }
      case 'saveEdit': {
        try {
          await this.store.updateIssue(this.issueNumber, {
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
          });
          await this._sendDetail();
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to save issue: ${(err as Error).message}`);
        }
        break;
      }
      case 'createBranch': {
        const issue = this.store.getByNumber(this.issueNumber);
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!issue || !cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'createWorktree': {
        const issue = this.store.getByNumber(this.issueNumber);
        if (!issue) break;
        await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
        break;
      }
      case 'postComment': {
        try {
          await this.store.addComment(this.issueNumber, msg.body);
          await this._sendDetail();
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to post comment: ${(err as Error).message}`);
          this.panel.webview.postMessage({ type: 'commentPostFailed' });
        }
        break;
      }
      case 'editComment': {
        try {
          await this.store.updateComment(msg.commentId, msg.body);
          await this._sendDetail();
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to update comment: ${(err as Error).message}`);
        }
        break;
      }
      case 'deleteComment': {
        const confirmed = await vscode.window.showWarningMessage(
          'Delete this comment?', { modal: true }, 'Delete',
        );
        if (confirmed !== 'Delete') break;
        try {
          await this.store.deleteComment(this.issueNumber, msg.commentId);
          await this._sendDetail();
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to delete comment: ${(err as Error).message}`);
        }
        break;
      }
      case 'submitCreate': {
        try {
          const created = await this.store.createIssue({
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
          });
          this.onCreated?.();
          await this.openIssue(created.number);
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
          this.panel.webview.postMessage({ type: 'createFailed' });
        }
        break;
      }
      case 'cancelCreate':
        this.panel.dispose();
        break;
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.js'),
    );
    const markedUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'marked.js'),
    );
    const purifyUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'purify.min.js'),
    );
    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.css'),
    );
    const sharedCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issues.css'),
    );
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${sharedCssUri}">
<link rel="stylesheet" href="${cssUri}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<div id="lightbox" class="hidden"><img id="lightbox-img" src="" alt=""></div>
<script nonce="${nonce}" src="${markedUri}"></script>
<script nonce="${nonce}" src="${purifyUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}
