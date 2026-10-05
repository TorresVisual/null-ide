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
const promptFormat_1 = require("./github/promptFormat");
const gitBranch_1 = require("./github/gitBranch");
const taskList_1 = require("./github/taskList");
const issueTemplates_1 = require("./github/issueTemplates");
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
    panel;
    issueNumber = 0;
    creating = false;
    onCreated;
    detail = null;
    loadedAt = 0;
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
    static async showCreate(extensionUri, store, onCreated) {
        const existing = IssueDetailPanel.creatingTab;
        if (existing) {
            existing.onCreated = onCreated;
            existing.panel.reveal();
            return;
        }
        const tab = new IssueDetailPanel(extensionUri, store);
        IssueDetailPanel.creatingTab = tab;
        await tab.openCreate(onCreated);
    }
    constructor(extensionUri, store) {
        this.extensionUri = extensionUri;
        this.store = store;
        this.panel = vscode.window.createWebviewPanel('null-tools.issueDetail', 'Issue', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
        });
        this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
        this.panel.webview.html = this._buildHtml();
        this.panel.webview.onDidReceiveMessage((msg) => void this._handleMessage(msg));
        this.panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active && this.issueNumber && Date.now() - this.loadedAt > STALE_MS)
                void this._load(false);
        });
        this.panel.onDidDispose(() => {
            if (IssueDetailPanel.byNumber.get(this.issueNumber) === this)
                IssueDetailPanel.byNumber.delete(this.issueNumber);
            if (IssueDetailPanel.shared === this)
                IssueDetailPanel.shared = undefined;
            if (IssueDetailPanel.creatingTab === this)
                IssueDetailPanel.creatingTab = undefined;
        });
    }
    _post(message) {
        void this.panel.webview.postMessage(message);
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
    async openCreate(onCreated) {
        this.creating = true;
        this.onCreated = onCreated;
        this.panel.title = 'New Issue';
        await this._sendCreateForm();
    }
    _cwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
        // Signed-out/offline must still show the form: Create itself prompts for sign-in
        // (ensureSession(true)), so an empty-picker form beats no form at all.
        const [repoLabels, assignableUsers] = await Promise.all([
            Promise.resolve([]),
            Promise.resolve([]),
        ]);
        const cwd = this._cwd();
        this._post({ type: 'createInit', repoLabels, assignableUsers, templates: cwd ? (0, issueTemplates_1.loadIssueTemplates)(cwd) : [] });
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
                await vscode.env.clipboard.writeText((0, promptFormat_1.formatIssueAsPrompt)(issue));
                this._post({ type: 'copied' });
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
                try {
                    const created = await this.store.createIssue({
                        title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
                    });
                    // This tab becomes the new issue's tab. Open it first so the store knows the issue, then let the
                    // lists insert it: they don't search for it, because GitHub's search index lags a few seconds.
                    if (IssueDetailPanel.creatingTab === this)
                        IssueDetailPanel.creatingTab = undefined;
                    IssueDetailPanel.shared ??= this;
                    await this.openIssue(created.number);
                    this.onCreated?.(created);
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
                    this._post({ type: 'createFailed' });
                }
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