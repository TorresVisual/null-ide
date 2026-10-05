'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuePatch } from './github/githubApi';
import { IssuesStore } from './github/issuesStore';
import { buildIssuePrompt } from './issuePrompt';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { toggleTaskCheckbox } from './github/taskList';
import { loadIssueTemplates } from './github/issueTemplates';
import { draftKey } from './github/issueDrafts';
import { issueImagesDir, mapLimit } from './github/imageCache';
import { UploadRejected } from './github/imageUpload';
import { GithubIssue, ReactionContent } from './github/types';

/** What a close/reopen button asks for. */
type StateTarget = 'completed' | 'not_planned' | 'reopen';

const STATE_PATCHES: Record<StateTarget, IssuePatch> = {
  completed: { state: 'closed', state_reason: 'completed' },
  not_planned: { state: 'closed', state_reason: 'not_planned' },
  reopen: { state: 'open', state_reason: 'reopened' },
};

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'loadMoreTimeline' }
  | { type: 'setTitle'; title: string }
  | { type: 'setState'; to: StateTarget }
  | { type: 'setAssignees'; logins: string[] }
  | { type: 'setLabels'; names: string[] }
  | { type: 'setMilestone'; number: number | null }
  | { type: 'setType'; id: string | null }
  | { type: 'toggleReaction'; subjectId: string; content: ReactionContent; add: boolean }
  | { type: 'requestCandidates' }
  | { type: 'addSubIssue'; number: number }
  | { type: 'removeSubIssue'; id: string }
  | { type: 'postComment'; body: string; then?: StateTarget }
  | { type: 'editPost'; kind: 'body' | 'comment'; id: string; body: string }
  | { type: 'deletePost'; id: string }
  | { type: 'toggleTask'; index: number; checked: boolean }
  | { type: 'openIssue'; number: number; newTab: boolean }
  | { type: 'openExternal'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'copyAsPrompt' }
  | { type: 'openInBrowser' }
  | { type: 'createBranch' }
  | { type: 'createWorktree' }
  | { type: 'preview'; requestId: number; text: string }
  | { type: 'suggest'; requestId: number; prefix: string }
  | { type: 'saveDraft'; number: number; body: string }
  | { type: 'resolveImages'; urls: string[] }
  | { type: 'uploadImage'; requestId: number; name: string; mime: string; dataBase64: string }
  | { type: 'submitCreate'; title: string; body: string; labels: string[]; assignees: string[]; milestone: number | null; typeId: string | null; parent: number | null; createMore: boolean }
  | { type: 'createSubIssue' }
  | { type: 'cancelCreate' };

/** A tab that regains focus after this long reloads its issue. */
const STALE_MS = 60_000;

const shortTitle = (title: string): string => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

export class IssueDetailPanel {
  /** Every open issue tab, by issue number, so opening an issue that already has a tab just focuses it. */
  private static readonly byNumber = new Map<number, IssueDetailPanel>();
  /** The tab a plain click reuses. Ctrl/middle-click opens a tab of its own that is never reused. */
  private static shared: IssueDetailPanel | undefined;
  /** The one New issue tab. */
  private static creatingTab: IssueDetailPanel | undefined;
  /** Where unsent comment text is kept; set once by registerIssuesPanelFeature. */
  private static drafts: vscode.Memento | undefined;

  /** Told about every issue created from the New issue tab, so the lists can show it before GitHub's search index catches up. */
  private static onCreated: ((issue: GithubIssue) => void) | undefined;

  static configure(drafts: vscode.Memento, onCreated: (issue: GithubIssue) => void): void {
    IssueDetailPanel.drafts = drafts;
    IssueDetailPanel.onCreated = onCreated;
  }

  private readonly panel: vscode.WebviewPanel;
  private issueNumber = 0;
  private creating = false;
  private parent: { number: number; title: string } | null = null;
  private detail: { id: string; timelineCursor: string | null } | null = null;
  private loadedAt = 0;
  private disposed = false;

  static async show(extensionUri: vscode.Uri, store: IssuesStore, issueNumber: number, newTab = false): Promise<void> {
    const existing = IssueDetailPanel.byNumber.get(issueNumber);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    let target = newTab ? undefined : IssueDetailPanel.shared;
    if (target) {
      target.panel.reveal();
    } else {
      target = new IssueDetailPanel(extensionUri, store);
      if (!newTab) IssueDetailPanel.shared = target;
    }
    await target.openIssue(issueNumber);
  }

  static async showCreate(
    extensionUri: vscode.Uri, store: IssuesStore, parent: { number: number; title: string } | null = null,
  ): Promise<void> {
    const existing = IssueDetailPanel.creatingTab;
    if (existing) {
      existing.panel.reveal();
      if (parent) existing._post({ type: 'setParent', parent }); // keep what the user already typed
      return;
    }
    const tab = new IssueDetailPanel(extensionUri, store);
    IssueDetailPanel.creatingTab = tab;
    await tab.openCreate(parent);
  }

  private constructor(private readonly extensionUri: vscode.Uri, private readonly store: IssuesStore) {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cacheRoots = cwd ? [vscode.Uri.file(issueImagesDir(cwd))] : [];
    this.panel = vscode.window.createWebviewPanel('null-tools.issueDetail', 'Issue', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      // The cache folder too: images the host downloaded are shown through asWebviewUri, which only serves these roots.
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib'), ...cacheRoots],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
    this.panel.webview.html = this._buildHtml();
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => void this._handleMessage(msg));
    this.panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active && this.issueNumber && Date.now() - this.loadedAt > STALE_MS) void this._load(false);
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (IssueDetailPanel.byNumber.get(this.issueNumber) === this) IssueDetailPanel.byNumber.delete(this.issueNumber);
      if (IssueDetailPanel.shared === this) IssueDetailPanel.shared = undefined;
      if (IssueDetailPanel.creatingTab === this) IssueDetailPanel.creatingTab = undefined;
    });
  }

  private _post(message: unknown): void {
    if (!this.disposed) void this.panel.webview.postMessage(message); // a reply can outlive its tab
  }

  private async openIssue(issueNumber: number): Promise<void> {
    if (IssueDetailPanel.byNumber.get(this.issueNumber) === this) IssueDetailPanel.byNumber.delete(this.issueNumber);
    this.creating = false;
    this.issueNumber = issueNumber;
    this.detail = null;
    IssueDetailPanel.byNumber.set(issueNumber, this);
    this.panel.title = `Issue #${issueNumber}`;
    await this._load(false);
  }

  private async openCreate(parent: { number: number; title: string } | null): Promise<void> {
    this.creating = true;
    this.parent = parent;
    this.panel.title = 'New Issue';
    await this._sendCreateForm();
  }

  private _cwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** An upload failed (no push access, offline): github.com can still take the image, so offer to open the page that does. */
  private async _offerAttachOnGithub(message: string): Promise<void> {
    const repo = this.store.getRepo();
    if (!repo) return;
    const url = this.creating || !this.issueNumber
      ? `https://github.com/${repo.owner}/${repo.repo}/issues/new`
      : this.store.getByNumber(this.issueNumber)?.html_url;
    if (!url) return;
    const choice = await vscode.window.showErrorMessage(`Couldn't attach the image: ${message}`, 'Attach on github.com');
    if (choice) await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /** `number` 0 is the New issue form. */
  private _draftKey(number: number): string | null {
    const repo = this.store.getRepo();
    return repo ? draftKey(repo, number || 'new') : null;
  }

  private _readDraft(number: number): string {
    const key = this._draftKey(number);
    return key && IssueDetailPanel.drafts ? IssueDetailPanel.drafts.get<string>(key, '') : '';
  }

  /** Empty or whitespace-only text deletes the draft. */
  private _writeDraft(number: number, body: string): void {
    const key = this._draftKey(number);
    if (key && IssueDetailPanel.drafts) void IssueDetailPanel.drafts.update(key, body.trim() ? body : undefined);
  }

  /** Fetches the issue and sends it. `afterWrite` tells the webview this answers one of its own writes. */
  private async _load(afterWrite: boolean): Promise<void> {
    const number = this.issueNumber;
    try {
      const detail = await this.store.getDetail(number);
      if (number !== this.issueNumber) return; // this tab moved on to another issue meanwhile
      this.detail = { id: detail.id, timelineCursor: detail.timelineCursor };
      this.loadedAt = Date.now();
      this.panel.title = `#${number} ${shortTitle(detail.issue.title)}`;
      const cwd = this._cwd();
      const repo = this.store.getRepo();
      this._post({
        type: 'detail', detail, afterWrite,
        draft: this._readDraft(number),
        viewer: this.store.getViewerLogin(),
        repo: repo ? `${repo.owner}/${repo.repo}` : '',
        closedLocally: detail.issue.state === 'open' && !!cwd && getLocallyClosedIssueNumbers(cwd).has(number),
      });
      void this._sendMetadata();
    } catch (err) {
      this._post(afterWrite
        ? { type: 'failed', what: 'refresh', message: (err as Error).message }
        : { type: 'error', message: (err as Error).message });
    }
  }

  private async _sendMetadata(): Promise<void> {
    try {
      const m = await this.store.getMetadata();
      this._post({ type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones, types: m.issueTypes });
    } catch {
      // The pickers just stay empty; the issue itself already loaded.
    }
  }

  private async _sendCreateForm(): Promise<void> {
    // Signed-out/offline must still show the form: Create itself prompts for sign-in (ensureSession(true)), so a
    // form with empty pickers beats no form at all.
    const m = await this.store.getMetadata().catch((): null => null);
    const cwd = this._cwd();
    this._post({
      type: 'createInit',
      metadata: { labels: m?.labels ?? [], assignees: m?.assignees ?? [], milestones: m?.milestones ?? [], types: m?.issueTypes ?? [] },
      templates: cwd ? loadIssueTemplates(cwd) : [],
      parent: this.parent,
      draft: this._readDraft(0),
    });
  }

  /** Runs one GitHub write, then reloads the issue so the tab shows GitHub's version (and any new timeline events). */
  private async _write(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
    } catch (err) {
      this._post({ type: 'failed', what: 'write', message: (err as Error).message });
      return false;
    }
    await this._load(true);
    return true;
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    const number = this.issueNumber;
    switch (msg.type) {
      case 'ready':
        if (this.creating) await this._sendCreateForm();
        else if (number) await this._load(false);
        break;
      case 'refresh':
        await this._load(false);
        break;
      case 'loadMoreTimeline': {
        const cursor = this.detail?.timelineCursor;
        if (!cursor) break;
        try {
          const page = await this.store.getTimelinePage(number, cursor);
          if (this.detail) this.detail.timelineCursor = page.cursor;
          this._post({ type: 'timelinePage', items: page.items, hasMore: page.hasMore });
        } catch (err) {
          this._post({ type: 'failed', what: 'timeline', message: (err as Error).message });
        }
        break;
      }
      case 'setTitle':
        await this._write(() => this.store.updateIssue(number, { title: msg.title }));
        break;
      case 'setState':
        await this._write(() => this.store.updateIssue(number, STATE_PATCHES[msg.to]));
        break;
      case 'setAssignees':
        await this._write(() => this.store.updateIssue(number, { assignees: msg.logins }));
        break;
      case 'setLabels':
        await this._write(() => this.store.updateIssue(number, { labels: msg.names }));
        break;
      case 'setMilestone':
        await this._write(() => this.store.updateIssue(number, { milestone: msg.number }));
        break;
      case 'setType':
        if (this.detail) await this._write(() => this.store.setIssueType(this.detail!.id, msg.id));
        break;
      case 'addSubIssue':
        if (this.detail) await this._write(() => this.store.addSubIssue(this.detail!.id, msg.number));
        break;
      case 'removeSubIssue':
        if (this.detail) await this._write(() => this.store.removeSubIssue(this.detail!.id, msg.id));
        break;
      case 'toggleReaction':
        try {
          const groups = await this.store.toggleReaction(msg.subjectId, msg.content, msg.add);
          this._post({ type: 'reactions', id: msg.subjectId, groups });
        } catch (err) {
          this._post({ type: 'failed', what: 'reaction', message: (err as Error).message });
        }
        break;
      case 'requestCandidates':
        try {
          // ponytail: the 50 newest open issues; add a debounced server search if that proves too few to pick from.
          const page = await this.store.search('is:open', null, false);
          this._post({
            type: 'candidates',
            items: page.items.filter(i => i.number !== number).map(i => ({ number: i.number, title: i.title })),
          });
        } catch (err) {
          this._post({ type: 'failed', what: 'candidates', message: (err as Error).message });
        }
        break;
      case 'postComment': {
        if (!this.detail) break;
        try {
          const item = await this.store.postComment(number, this.detail.id, msg.body);
          this._post({ type: 'commentAdded', item });
          this._writeDraft(number, '');
        } catch (err) {
          // With a close/reopen attached, the webview already applied it optimistically and has to undo it.
          this._post({ type: 'failed', what: msg.then ? 'write' : 'comment', message: (err as Error).message });
          break;
        }
        if (msg.then) {
          const to = msg.then;
          await this._write(() => this.store.updateIssue(number, STATE_PATCHES[to]));
        }
        break;
      }
      case 'editPost':
        if (msg.kind === 'body') {
          await this._write(() => this.store.updateIssue(number, { body: msg.body }));
        } else {
          try {
            this._post({ type: 'postUpdated', item: await this.store.editComment(msg.id, msg.body) });
          } catch (err) {
            this._post({ type: 'failed', what: 'edit', message: (err as Error).message });
          }
        }
        break;
      case 'deletePost': {
        const confirmed = await vscode.window.showWarningMessage('Delete this comment?', { modal: true }, 'Delete');
        if (confirmed !== 'Delete') break;
        try {
          await this.store.removeComment(number, msg.id);
          this._post({ type: 'postDeleted', id: msg.id });
        } catch (err) {
          this._post({ type: 'failed', what: 'delete', message: (err as Error).message });
        }
        break;
      }
      case 'toggleTask': {
        const body = this.store.getByNumber(number)?.body;
        const newBody = body ? toggleTaskCheckbox(body, msg.index, msg.checked) : null;
        if (newBody === null) {
          this._post({ type: 'failed', what: 'write', message: 'Could not find that checkbox in the issue text.' });
          break;
        }
        await this._write(() => this.store.updateIssue(number, { body: newBody }));
        break;
      }
      case 'preview':
        try {
          this._post({ type: 'previewResult', requestId: msg.requestId, html: await this.store.renderPreview(msg.text) });
        } catch (err) {
          this._post({ type: 'previewResult', requestId: msg.requestId, error: (err as Error).message });
        }
        break;
      case 'suggest':
        this._post({ type: 'suggestions', requestId: msg.requestId, items: await this.store.suggestIssues(msg.prefix).catch(() => []) });
        break;
      case 'resolveImages': {
        // At most 50 per message and 4 downloads at a time; a failure is reported per image and never stops the rest.
        const urls = (Array.isArray(msg.urls) ? msg.urls : []).filter((u): u is string => typeof u === 'string').slice(0, 50);
        await mapLimit(urls, 4, async url => {
          try {
            const file = await this.store.resolveImage(url);
            this._post({ type: 'imageResolved', url, src: this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() });
          } catch (err) {
            this._post({ type: 'imageFailed', url, message: (err as Error).message });
          }
        });
        break;
      }
      case 'uploadImage':
        try {
          const bytes = Buffer.from(String(msg.dataBase64), 'base64');
          this._post({ type: 'uploadResult', requestId: msg.requestId, markdown: await this.store.uploadImage(String(msg.name), String(msg.mime), bytes) });
        } catch (err) {
          const message = (err as Error).message;
          this._post({ type: 'uploadResult', requestId: msg.requestId, error: message });
          if (err instanceof UploadRejected) void vscode.window.showErrorMessage(message);
          else void this._offerAttachOnGithub(message);
        }
        break;
      case 'saveDraft':
        this._writeDraft(msg.number, msg.body);
        break;
      case 'createSubIssue':
        await IssueDetailPanel.showCreate(this.extensionUri, this.store, { number, title: this.store.getByNumber(number)?.title ?? '' });
        break;
      case 'openIssue':
        await IssueDetailPanel.show(this.extensionUri, this.store, msg.number, msg.newTab);
        break;
      case 'openExternal':
        // The webview only sends links it found in GitHub-rendered HTML, but never hand an arbitrary scheme to the OS.
        if (/^https:\/\//i.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case 'copyText':
        await vscode.env.clipboard.writeText(msg.text);
        break;
      case 'copyAsPrompt': {
        const issue = this.store.getByNumber(number);
        if (!issue) break;
        const { text, warning } = await buildIssuePrompt(this.store, issue);
        await vscode.env.clipboard.writeText(text);
        this._post({ type: 'copied' });
        if (warning) void vscode.window.showWarningMessage(warning);
        break;
      }
      case 'openInBrowser': {
        const issue = this.store.getByNumber(number);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      }
      case 'createBranch': {
        const issue = this.store.getByNumber(number);
        const cwd = this._cwd();
        if (!issue || !cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'createWorktree': {
        const issue = this.store.getByNumber(number);
        if (issue) await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
        break;
      }
      case 'submitCreate': {
        let created: GithubIssue;
        try {
          created = await this.store.createIssue({
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees, milestone: msg.milestone ?? undefined,
          });
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
          this._post({ type: 'createFailed' });
          break;
        }
        this._writeDraft(0, ''); // only now that the issue exists
        const problems = await this.store.applyCreateExtras(created, { typeId: msg.typeId, parent: msg.parent });
        if (problems.length > 0) void vscode.window.showWarningMessage(`Created #${created.number}, but ${problems.join(' and ')}.`);
        if (msg.parent) void IssueDetailPanel.byNumber.get(msg.parent)?._load(false); // its Sub-issues list just grew
        if (msg.createMore) {
          this._post({ type: 'created', number: created.number });
        } else {
          // This tab becomes the new issue's tab.
          if (IssueDetailPanel.creatingTab === this) IssueDetailPanel.creatingTab = undefined;
          IssueDetailPanel.shared ??= this;
          await this.openIssue(created.number);
        }
        // The store already knows the issue (createIssue remembered it); the lists can't search for it yet, so they insert it.
        IssueDetailPanel.onCreated?.(created);
        break;
      }
      case 'cancelCreate':
        this.panel.dispose();
        break;
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const asUri = (file: string): vscode.Uri => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${asUri('issues.css')}">
<link rel="stylesheet" href="${asUri('issueDetail.css')}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${asUri('purify.min.js')}"></script>
<script nonce="${nonce}" src="${asUri('issueDetail.js')}"></script>
</body></html>`;
  }
}
