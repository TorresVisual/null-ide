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
  | { type: 'copyAsPrompt' }
  | { type: 'openInBrowser' }
  | { type: 'setState'; state: 'open' | 'closed' }
  | { type: 'toggleTask'; index: number; checked: boolean }
  | { type: 'saveEdit'; title: string; body: string; labels: string[]; assignees: string[] }
  | { type: 'createBranch' }
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
      const [repoLabels, assignableUsers] = await Promise.all([
        this.store.getRepoLabels(),
        this.store.getAssignableUsers(),
      ]);
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
          if (!created) break;
          this.onCreated?.();
          await this.openIssue(created.number);
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
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
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<style>
  html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
              font:var(--vscode-font-size,13px)/1.6 var(--vscode-font-family); }
  #detail { max-width:900px; margin:0 auto; padding:24px; }
  h2 { color:var(--vscode-foreground); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .state-badge {
    font-size:.85em; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
    padding:2px 8px; border-radius:999px; color:#fff; background:var(--vscode-charts-green,#89d185);
  }
  .state-badge.closed { background:var(--vscode-charts-red,#f14c4c); }
  .closes-badge {
    font-size:.85em; font-weight:600; padding:2px 8px; border-radius:999px; color:#111;
    background:var(--vscode-charts-yellow,#cca700);
  }
  .label-chip { display:inline-block; padding:0 6px; border-radius:999px; font-size:.8em; margin-right:4px; color:#111; }
  .issue-meta { color:var(--vscode-descriptionForeground); font-size:.85em; margin:6px 0; }
  .meta-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--vscode-descriptionForeground); font-size:.9em; margin:8px 0; }
  .avatar {
    position:relative; overflow:hidden; width:20px; height:20px; border-radius:50%; display:inline-flex;
    align-items:center; justify-content:center; font-size:.7em; font-weight:700; flex-shrink:0;
    background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
  }
  .avatar::before { content: attr(data-initials); }
  .avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .assignees-row { display:flex; align-items:center; gap:6px; margin:10px 0; }
  .assignees-label { text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); font-size:.8em; }
  .assignee-chip {
    display:inline-flex; align-items:center; gap:5px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
    border-radius:999px; padding:2px 8px 2px 2px; font-size:.85em;
  }
  .body-card {
    border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); border-radius:6px; padding:14px; margin:14px 0;
    background:var(--vscode-editorWidget-background,rgba(128,128,128,.03));
  }
  .body-card, .comment-body { line-height:1.5; word-wrap:break-word; }
  .body-card > *:first-child, .comment-body > *:first-child { margin-top:0; }
  .body-card > *:last-child, .comment-body > *:last-child { margin-bottom:0; }
  .body-card h1, .comment-body h1 {
    font-size:1.6em; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding-bottom:.3em;
  }
  .body-card h2, .comment-body h2 {
    font-size:1.35em; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding-bottom:.25em;
  }
  .body-card h3, .comment-body h3 { font-size:1.15em; }
  .body-card h4, .comment-body h4 { font-size:1em; }
  .body-card pre, .comment-body pre {
    background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:10px; border-radius:4px; overflow-x:auto;
  }
  .body-card code, .comment-body code {
    background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:1px 4px; border-radius:3px;
    font-family:var(--vscode-editor-font-family,monospace);
  }
  .body-card pre code, .comment-body pre code { background:none; padding:0; }
  .body-card blockquote, .comment-body blockquote {
    border-left:3px solid var(--vscode-widget-border,rgba(128,128,128,.3)); margin:0; padding:2px 12px; color:var(--vscode-descriptionForeground);
  }
  .body-card a, .comment-body a { color:var(--vscode-textLink-foreground); }
  .body-card table, .comment-body table { border-collapse:collapse; }
  .body-card th, .body-card td, .comment-body th, .comment-body td {
    border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding:4px 8px;
  }
  .body-card ul.contains-task-list, .comment-body ul.contains-task-list { list-style:none; padding-left:.5em; }
  .body-card input[type=checkbox] { cursor:pointer; }
  .body-card img, .comment-body img { max-height:400px; object-fit:contain; cursor:zoom-in; display:block; }
  #lightbox {
    position:fixed; inset:0; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center;
    cursor:zoom-out; z-index:1000;
  }
  #lightbox.hidden { display:none; }
  #lightbox img { max-width:90vw; max-height:90vh; object-fit:contain; box-shadow:0 8px 32px rgba(0,0,0,.5); }
  .btn-row { display:flex; align-items:center; gap:8px; margin:14px 0; flex-wrap:wrap; }
  .btn-row-divider { width:1px; align-self:stretch; min-height:24px; background:var(--vscode-widget-border,rgba(128,128,128,.2)); }
  button.btn { border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font:inherit; font-weight:500; transition:filter .15s,background .15s; }
  button.btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  button.btn-primary:hover { background:var(--vscode-button-hoverBackground); filter:brightness(1.08); }
  button.btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  button.btn-secondary:hover { background:var(--vscode-button-secondaryHoverBackground); filter:brightness(1.08); }
  button.btn-ghost { background:transparent; border:1px solid var(--vscode-input-border,var(--vscode-widget-border,rgba(128,128,128,.3))); color:var(--vscode-foreground); }
  button.btn-ghost:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
  button.btn-danger { background:var(--vscode-errorForeground,#f14c4c); color:#fff; }
  button.btn-danger:hover { filter:brightness(1.1); }
  button.btn-close { background:var(--vscode-errorForeground,#f14c4c); color:#fff; }
  button.btn-close:hover { filter:brightness(1.1); }
  button.btn-reopen { background:var(--vscode-charts-green,#89d185); color:#111; }
  button.btn-reopen:hover { filter:brightness(1.08); }
  button.btn:disabled { opacity:.5; cursor:default; }
  .edit-form input, .edit-form textarea, .edit-form select {
    width:100%; box-sizing:border-box; background:var(--vscode-input-background); color:var(--vscode-input-foreground);
    border:1px solid var(--vscode-input-border,transparent); border-radius:4px; padding:8px; font:inherit; margin-bottom:8px;
  }
  .edit-form input:focus, .edit-form textarea:focus, #comment-input:focus { outline:none; border-color:var(--vscode-focusBorder); }
  .edit-form textarea { min-height:160px; resize:vertical; }
  .picker-group { margin-bottom:10px; }
  .dropdown-container { position:relative; }
  .dropdown-trigger {
    width:100%; min-height:30px; padding:4px 28px 4px 8px; border:1px solid var(--vscode-input-border,transparent);
    background:var(--vscode-input-background); color:var(--vscode-input-foreground); border-radius:4px; cursor:pointer;
    display:flex; align-items:center; text-align:left; position:relative; box-sizing:border-box; font:inherit;
    transition:border-color .15s;
  }
  .dropdown-trigger:hover { border-color:var(--vscode-focusBorder); }
  .dropdown-arrow { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:.7em; color:var(--vscode-descriptionForeground); pointer-events:none; }
  .dropdown-placeholder { color:var(--vscode-input-placeholderForeground); font-size:.9em; }
  .selected-tags { display:flex; flex-wrap:wrap; gap:4px; }
  .tag { display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border-radius:999px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); font-size:.82em; }
  .tag-remove { cursor:pointer; font-size:1.1em; line-height:1; opacity:.7; transition:opacity .1s; }
  .tag-remove:hover { opacity:1; }
  .dropdown-list {
    position:absolute; top:100%; left:0; right:0; margin-top:2px; border:1px solid var(--vscode-input-border,transparent);
    background:var(--vscode-dropdown-background,var(--vscode-input-background)); border-radius:4px; max-height:180px;
    overflow-y:auto; z-index:10; box-shadow:0 4px 12px rgba(0,0,0,.3);
  }
  .dropdown-list.hidden { display:none; }
  .dropdown-item {
    width:100%; padding:6px 10px; border:none; background:transparent; color:var(--vscode-foreground); cursor:pointer;
    display:flex; align-items:center; gap:6px; font-size:.9em; text-align:left; font:inherit; transition:background .1s;
  }
  .dropdown-item:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
  .dropdown-item.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
  .dropdown-item .checkbox { flex-shrink:0; }
  .dropdown-item .color-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
  h3 { font-size:1em; margin:22px 0 8px; }
  .comment {
    border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); border-radius:6px; margin:10px 0; overflow:hidden;
    transition:border-color .15s;
  }
  .comment:hover { border-color:var(--vscode-focusBorder); }
  .comment-header {
    display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;
    padding:8px 12px; background:var(--vscode-editor-inactiveSelectionBackground); font-size:.9em;
  }
  .comment-author-group { display:flex; align-items:center; gap:6px; min-width:0; }
  .comment-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .comment-body { padding:10px 12px; }
  .comment .edit-form { padding:10px 12px; }
  .comment-link-btn {
    background:transparent; border:none; color:var(--vscode-textLink-foreground); cursor:pointer; padding:1px 4px;
    font:inherit; font-size:.85em; border-radius:3px; transition:background .12s,color .12s;
  }
  .comment-link-btn:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
  .comment-link-btn.danger { color:var(--vscode-errorForeground); }
  .timeline-event { color:var(--vscode-descriptionForeground); font-size:.9em; padding:6px 0; }
  .timeline-event code { background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:1px 4px; border-radius:3px; }
  .comment-author { color:var(--vscode-textLink-foreground); font-weight:600; }
  #composer { margin-top:10px; }
  #comment-input {
    width:100%; box-sizing:border-box; min-height:70px; resize:vertical; background:var(--vscode-input-background);
    color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:4px;
    padding:8px; font:inherit;
  }
  #composer .btn-row { justify-content:flex-end; }
  #empty { padding:20px; color:var(--vscode-descriptionForeground); }
</style></head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<div id="lightbox" class="hidden"><img id="lightbox-img" src="" alt=""></div>
<script nonce="${nonce}" src="${markedUri}"></script>
<script nonce="${nonce}" src="${purifyUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}
