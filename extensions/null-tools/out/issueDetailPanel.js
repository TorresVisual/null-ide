'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueDetailPanel = void 0;
const vscode = __importStar(require("vscode"));
const webviewUtils_1 = require("./webviewUtils");
const issuePrompt_1 = require("./issuePrompt");
const gitBranch_1 = require("./github/gitBranch");
const taskList_1 = require("./github/taskList");
const issueTemplates_1 = require("./github/issueTemplates");
const issueDrafts_1 = require("./github/issueDrafts");
const imageCache_1 = require("./github/imageCache");
const STATE_PATCHES = {
    completed: { state: 'closed', state_reason: 'completed' },
    not_planned: { state: 'closed', state_reason: 'not_planned' },
    reopen: { state: 'open', state_reason: 'reopened' },
};
/** A tab that regains focus after this long reloads its issue. */
const STALE_MS = 60_000;
const shortTitle = (title) => (title.length > 32 ? `${title.slice(0, 31)}…` : title);
class IssueDetailPanel {
    extensionUri;
    store;
    /** Every open issue tab, by issue number, so opening an issue that already has a tab just focuses it. */
    static byNumber = new Map();
    /** The tab a plain click reuses. Ctrl/middle-click opens a tab of its own that is never reused. */
    static shared;
    /** The one New issue tab. */
    static creatingTab;
    /** Where unsent comment text is kept; set once by registerIssuesPanelFeature. */
    static drafts;
    /** Told about every issue created from the New issue tab, so the lists can show it before GitHub's search index catches up. */
    static onCreated;
    static configure(drafts, onCreated) {
        IssueDetailPanel.drafts = drafts;
        IssueDetailPanel.onCreated = onCreated;
    }
    panel;
    issueNumber = 0;
    creating = false;
    parent = null;
    detail = null;
    loadedAt = 0;
    disposed = false;
    static async show(extensionUri, store, issueNumber, newTab = false) {
        const existing = IssueDetailPanel.byNumber.get(issueNumber);
        if (existing) {
            existing.panel.reveal();
            return;
        }
        let target = newTab ? undefined : IssueDetailPanel.shared;
        if (target) {
            target.panel.reveal();
        }
        else {
            target = new IssueDetailPanel(extensionUri, store);
            if (!newTab)
                IssueDetailPanel.shared = target;
        }
        await target.openIssue(issueNumber);
    }
    static async showCreate(extensionUri, store, parent = null) {
        const existing = IssueDetailPanel.creatingTab;
        if (existing) {
            existing.panel.reveal();
            if (parent)
                existing._post({ type: 'setParent', parent }); // keep what the user already typed
            return;
        }
        const tab = new IssueDetailPanel(extensionUri, store);
        IssueDetailPanel.creatingTab = tab;
        await tab.openCreate(parent);
    }
    constructor(extensionUri, store) {
        this.extensionUri = extensionUri;
        this.store = store;
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const cacheRoots = cwd ? [vscode.Uri.file((0, imageCache_1.issueImagesDir)(cwd))] : [];
        this.panel = vscode.window.createWebviewPanel('null-tools.issueDetail', 'Issue', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            // The cache folder too: images the host downloaded are shown through asWebviewUri, which only serves these roots.
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib'), ...cacheRoots],
        });
        this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
        this.panel.webview.html = this._buildHtml();
        this.panel.webview.onDidReceiveMessage((msg) => void this._handleMessage(msg));
        this.panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active && this.issueNumber && Date.now() - this.loadedAt > STALE_MS)
                void this._load(false);
        });
        this.panel.onDidDispose(() => {
            this.disposed = true;
            if (IssueDetailPanel.byNumber.get(this.issueNumber) === this)
                IssueDetailPanel.byNumber.delete(this.issueNumber);
            if (IssueDetailPanel.shared === this)
                IssueDetailPanel.shared = undefined;
            if (IssueDetailPanel.creatingTab === this)
                IssueDetailPanel.creatingTab = undefined;
        });
    }
    _post(message) {
        if (!this.disposed)
            void this.panel.webview.postMessage(message); // a reply can outlive its tab
    }
    async openIssue(issueNumber) {
        if (IssueDetailPanel.byNumber.get(this.issueNumber) === this)
            IssueDetailPanel.byNumber.delete(this.issueNumber);
        this.creating = false;
        this.issueNumber = issueNumber;
        this.detail = null;
        IssueDetailPanel.byNumber.set(issueNumber, this);
        this.panel.title = `Issue #${issueNumber}`;
        await this._load(false);
    }
    async openCreate(parent) {
        this.creating = true;
        this.parent = parent;
        this.panel.title = 'New Issue';
        await this._sendCreateForm();
    }
    _cwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    /** `number` 0 is the New issue form. */
    _draftKey(number) {
        const repo = this.store.getRepo();
        return repo ? (0, issueDrafts_1.draftKey)(repo, number || 'new') : null;
    }
    _readDraft(number) {
        const key = this._draftKey(number);
        return key && IssueDetailPanel.drafts ? IssueDetailPanel.drafts.get(key, '') : '';
    }
    /** Empty or whitespace-only text deletes the draft. */
    _writeDraft(number, body) {
        const key = this._draftKey(number);
        if (key && IssueDetailPanel.drafts)
            void IssueDetailPanel.drafts.update(key, body.trim() ? body : undefined);
    }
    /** Fetches the issue and sends it. `afterWrite` tells the webview this answers one of its own writes. */
    async _load(afterWrite) {
        const number = this.issueNumber;
        try {
            const detail = await this.store.getDetail(number);
            if (number !== this.issueNumber)
                return; // this tab moved on to another issue meanwhile
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
                closedLocally: detail.issue.state === 'open' && !!cwd && (0, gitBranch_1.getLocallyClosedIssueNumbers)(cwd).has(number),
            });
            void this._sendMetadata();
        }
        catch (err) {
            this._post(afterWrite
                ? { type: 'failed', what: 'refresh', message: err.message }
                : { type: 'error', message: err.message });
        }
    }
    async _sendMetadata() {
        try {
            const m = await this.store.getMetadata();
            this._post({ type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones, types: m.issueTypes });
        }
        catch {
            // The pickers just stay empty; the issue itself already loaded.
        }
    }
    async _sendCreateForm() {
        // Signed-out/offline must still show the form: Create itself prompts for sign-in (ensureSession(true)), so a
        // form with empty pickers beats no form at all.
        const m = await this.store.getMetadata().catch(() => null);
        const cwd = this._cwd();
        this._post({
            type: 'createInit',
            metadata: { labels: m?.labels ?? [], assignees: m?.assignees ?? [], milestones: m?.milestones ?? [], types: m?.issueTypes ?? [] },
            templates: cwd ? (0, issueTemplates_1.loadIssueTemplates)(cwd) : [],
            parent: this.parent,
            draft: this._readDraft(0),
        });
    }
    /** Runs one GitHub write, then reloads the issue so the tab shows GitHub's version (and any new timeline events). */
    async _write(action) {
        try {
            await action();
        }
        catch (err) {
            this._post({ type: 'failed', what: 'write', message: err.message });
            return false;
        }
        await this._load(true);
        return true;
    }
    async _handleMessage(msg) {
        const number = this.issueNumber;
        switch (msg.type) {
            case 'ready':
                if (this.creating)
                    await this._sendCreateForm();
                else if (number)
                    await this._load(false);
                break;
            case 'refresh':
                await this._load(false);
                break;
            case 'loadMoreTimeline': {
                const cursor = this.detail?.timelineCursor;
                if (!cursor)
                    break;
                try {
                    const page = await this.store.getTimelinePage(number, cursor);
                    if (this.detail)
                        this.detail.timelineCursor = page.cursor;
                    this._post({ type: 'timelinePage', items: page.items, hasMore: page.hasMore });
                }
                catch (err) {
                    this._post({ type: 'failed', what: 'timeline', message: err.message });
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
                if (this.detail)
                    await this._write(() => this.store.setIssueType(this.detail.id, msg.id));
                break;
            case 'addSubIssue':
                if (this.detail)
                    await this._write(() => this.store.addSubIssue(this.detail.id, msg.number));
                break;
            case 'removeSubIssue':
                if (this.detail)
                    await this._write(() => this.store.removeSubIssue(this.detail.id, msg.id));
                break;
            case 'toggleReaction':
                try {
                    const groups = await this.store.toggleReaction(msg.subjectId, msg.content, msg.add);
                    this._post({ type: 'reactions', id: msg.subjectId, groups });
                }
                catch (err) {
                    this._post({ type: 'failed', what: 'reaction', message: err.message });
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
                }
                catch (err) {
                    this._post({ type: 'failed', what: 'candidates', message: err.message });
                }
                break;
            case 'postComment': {
                if (!this.detail)
                    break;
                try {
                    const item = await this.store.postComment(number, this.detail.id, msg.body);
                    this._post({ type: 'commentAdded', item });
                    this._writeDraft(number, '');
                }
                catch (err) {
                    // With a close/reopen attached, the webview already applied it optimistically and has to undo it.
                    this._post({ type: 'failed', what: msg.then ? 'write' : 'comment', message: err.message });
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
                }
                else {
                    try {
                        this._post({ type: 'postUpdated', item: await this.store.editComment(msg.id, msg.body) });
                    }
                    catch (err) {
                        this._post({ type: 'failed', what: 'edit', message: err.message });
                    }
                }
                break;
            case 'deletePost': {
                const confirmed = await vscode.window.showWarningMessage('Delete this comment?', { modal: true }, 'Delete');
                if (confirmed !== 'Delete')
                    break;
                try {
                    await this.store.removeComment(number, msg.id);
                    this._post({ type: 'postDeleted', id: msg.id });
                }
                catch (err) {
                    this._post({ type: 'failed', what: 'delete', message: err.message });
                }
                break;
            }
            case 'toggleTask': {
                const body = this.store.getByNumber(number)?.body;
                const newBody = body ? (0, taskList_1.toggleTaskCheckbox)(body, msg.index, msg.checked) : null;
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
                }
                catch (err) {
                    this._post({ type: 'previewResult', requestId: msg.requestId, error: err.message });
                }
                break;
            case 'suggest':
                this._post({ type: 'suggestions', requestId: msg.requestId, items: await this.store.suggestIssues(msg.prefix).catch(() => []) });
                break;
            case 'resolveImages': {
                // At most 50 per message and 4 downloads at a time; a failure is reported per image and never stops the rest.
                const urls = (Array.isArray(msg.urls) ? msg.urls : []).filter((u) => typeof u === 'string').slice(0, 50);
                await (0, imageCache_1.mapLimit)(urls, 4, async (url) => {
                    try {
                        const file = await this.store.resolveImage(url);
                        this._post({ type: 'imageResolved', url, src: this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() });
                    }
                    catch (err) {
                        this._post({ type: 'imageFailed', url, message: err.message });
                    }
                });
                break;
            }
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
                if (/^https:\/\//i.test(msg.url))
                    await vscode.env.openExternal(vscode.Uri.parse(msg.url));
                break;
            case 'copyText':
                await vscode.env.clipboard.writeText(msg.text);
                break;
            case 'copyAsPrompt': {
                const issue = this.store.getByNumber(number);
                if (!issue)
                    break;
                const { text, warning } = await (0, issuePrompt_1.buildIssuePrompt)(this.store, issue);
                await vscode.env.clipboard.writeText(text);
                this._post({ type: 'copied' });
                if (warning)
                    void vscode.window.showWarningMessage(warning);
                break;
            }
            case 'openInBrowser': {
                const issue = this.store.getByNumber(number);
                if (issue)
                    await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
                break;
            }
            case 'createBranch': {
                const issue = this.store.getByNumber(number);
                const cwd = this._cwd();
                if (!issue || !cwd)
                    break;
                const result = (0, gitBranch_1.createIssueBranch)(cwd, issue.number, issue.title);
                if (result.ok)
                    void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
                else
                    void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
                break;
            }
            case 'createWorktree': {
                const issue = this.store.getByNumber(number);
                if (issue)
                    await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
                break;
            }
            case 'submitCreate': {
                let created;
                try {
                    created = await this.store.createIssue({
                        title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees, milestone: msg.milestone ?? undefined,
                    });
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
                    this._post({ type: 'createFailed' });
                    break;
                }
                this._writeDraft(0, ''); // only now that the issue exists
                const problems = await this.store.applyCreateExtras(created, { typeId: msg.typeId, parent: msg.parent });
                if (problems.length > 0)
                    void vscode.window.showWarningMessage(`Created #${created.number}, but ${problems.join(' and ')}.`);
                if (msg.parent)
                    void IssueDetailPanel.byNumber.get(msg.parent)?._load(false); // its Sub-issues list just grew
                if (msg.createMore) {
                    this._post({ type: 'created', number: created.number });
                }
                else {
                    // This tab becomes the new issue's tab.
                    if (IssueDetailPanel.creatingTab === this)
                        IssueDetailPanel.creatingTab = undefined;
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
    _buildHtml() {
        const nonce = (0, webviewUtils_1.getNonce)();
        const asUri = (file) => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
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
exports.IssueDetailPanel = IssueDetailPanel;
//# sourceMappingURL=issueDetailPanel.js.map