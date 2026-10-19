'use strict';

import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { getNonce } from '../webviewUtils';
import { PAGE_ACTIONS, PageAction, runAction } from './pullActions';
import { fetchPullPage, rerunFailedRuns } from './pullDetailApi';
import { PullPage, failedRunIds, safeExternalUrl } from './pullDetailModel';
import { PullSummary, describeFailure } from './pullModel';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'checkout' }
  | { type: 'rerun' }
  | { type: PageAction }
  | { type: 'openExternal'; url: string };

/** A tab that regains focus after this long reloads its pull request. */
const STALE_MS = 60_000;

const shortTitle = (title: string): string => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

export class PullDetailPanel {
  /** One tab per pull request, so opening one that already has a tab just focuses it. */
  private static readonly byNumber = new Map<number, PullDetailPanel>();

  static show(extensionUri: vscode.Uri, repo: { owner: string; repo: string }, pull: PullSummary): void {
    const existing = PullDetailPanel.byNumber.get(pull.number);
    if (existing) existing.panel.reveal();
    else new PullDetailPanel(extensionUri, repo, pull);
  }

  private readonly panel: vscode.WebviewPanel;
  private page: PullPage | null = null;
  private loadedAt = 0;
  private disposed = false;
  private busy = false;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repo: { owner: string; repo: string },
    private readonly pull: PullSummary,
  ) {
    this.panel = vscode.window.createWebviewPanel('null-tools.pullDetail', `#${pull.number}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
    });
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'github-issues-dark.svg'),
    };
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => void this.handle(msg));
    this.panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active && this.page && Date.now() - this.loadedAt > STALE_MS) void this.load();
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      PullDetailPanel.byNumber.delete(pull.number);
    });
    PullDetailPanel.byNumber.set(pull.number, this);
  }

  private post(message: unknown): void {
    if (!this.disposed) void this.panel.webview.postMessage(message); // a reply can outlive its tab
  }

  /** Fetches the page and sends it. A failed refresh of a page already on screen is a toast, not a blank tab. */
  private async load(): Promise<void> {
    try {
      const session = await getGithubSession(false);
      const page = await fetchPullPage(this.repo.owner, this.repo.repo, this.pull.number, session?.accessToken ?? null);
      this.page = page;
      this.loadedAt = Date.now();
      this.panel.title = `#${page.number} ${shortTitle(page.title)}`;
      this.post({ type: 'page', page });
    } catch (err) {
      this.post({ type: this.page ? 'toast' : 'error', message: describeFailure(err) });
    }
  }

  private async rerun(): Promise<void> {
    // The run ids come from the page this host loaded; the webview sends none.
    const ids = this.page ? failedRunIds(this.page.checks) : [];
    if (ids.length === 0) return;
    const session = await getGithubSession(true);
    if (!session) {
      this.post({ type: 'toast', message: 'Sign in to GitHub to re-run jobs.' });
    } else {
      const { started, errors } = await rerunFailedRuns(this.repo.owner, this.repo.repo, ids, session.accessToken);
      const startedText = started > 0 ? `Re-running the failed jobs of ${started} workflow run${started === 1 ? '' : 's'}.` : '';
      this.post({ type: 'toast', message: [startedText, ...errors].filter(Boolean).join(' ') });
    }
    await this.load(); // also re-enables the button
  }

  /** One write at a time: a second click (or a second button) while a dialog or request is open is dropped. */
  private async act(action: PageAction): Promise<void> {
    if (this.busy || !this.page) return;
    this.busy = true;
    try {
      const outcome = await runAction(action, { ...this.repo, number: this.pull.number }, this.page);
      if (outcome === 'cancelled') {
        this.post({ type: 'page', page: this.page }); // same page again: re-enables the buttons
      } else {
        await this.load(); // a refusal can mean the PR changed (moved head, closed elsewhere): show it as it is now
        void vscode.commands.executeCommand('null.pulls.refresh'); // state icon, merged PRs leave the Open list
      }
    } finally {
      this.busy = false;
    }
  }

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.load();
        break;
      case 'checkout':
        // The tree owns checkout (progress, branch naming, moving the ● marker).
        void vscode.commands.executeCommand('null.pulls.checkout', { kind: 'pull', pull: this.pull });
        break;
      case 'rerun':
        await this.rerun();
        break;
      case 'review': case 'merge': case 'close': case 'reopen': case 'ready': case 'draft':
        if (PAGE_ACTIONS.has(msg.type)) await this.act(msg.type);
        break;
      case 'openExternal': {
        const url = safeExternalUrl(msg.url);
        if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
    }
  }

  private buildHtml(): string {
    const nonce = getNonce();
    const asUri = (file: string): vscode.Uri => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${asUri('issues.css')}">
<link rel="stylesheet" href="${asUri('issueDetail.css')}">
<link rel="stylesheet" href="${asUri('pullDetail.css')}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${asUri('purify.min.js')}"></script>
<script nonce="${nonce}" src="${asUri('pullDetail.js')}"></script>
</body></html>`;
  }
}
