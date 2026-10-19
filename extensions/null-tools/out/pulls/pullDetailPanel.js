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
exports.PullDetailPanel = void 0;
const vscode = __importStar(require("vscode"));
const githubAuth_1 = require("../github/githubAuth");
const webviewUtils_1 = require("../webviewUtils");
const pullActions_1 = require("./pullActions");
const pullDetailApi_1 = require("./pullDetailApi");
const pullDetailModel_1 = require("./pullDetailModel");
const pullModel_1 = require("./pullModel");
/** A tab that regains focus after this long reloads its pull request. */
const STALE_MS = 60_000;
const shortTitle = (title) => (title.length > 32 ? `${title.slice(0, 31)}…` : title);
class PullDetailPanel {
    extensionUri;
    repo;
    pull;
    /** One tab per pull request, so opening one that already has a tab just focuses it. */
    static byNumber = new Map();
    static show(extensionUri, repo, pull) {
        const existing = PullDetailPanel.byNumber.get(pull.number);
        if (existing)
            existing.panel.reveal();
        else
            new PullDetailPanel(extensionUri, repo, pull);
    }
    panel;
    page = null;
    loadedAt = 0;
    disposed = false;
    busy = false;
    constructor(extensionUri, repo, pull) {
        this.extensionUri = extensionUri;
        this.repo = repo;
        this.pull = pull;
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
        this.panel.webview.onDidReceiveMessage((msg) => void this.handle(msg));
        this.panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active && this.page && Date.now() - this.loadedAt > STALE_MS)
                void this.load();
        });
        this.panel.onDidDispose(() => {
            this.disposed = true;
            PullDetailPanel.byNumber.delete(pull.number);
        });
        PullDetailPanel.byNumber.set(pull.number, this);
    }
    post(message) {
        if (!this.disposed)
            void this.panel.webview.postMessage(message); // a reply can outlive its tab
    }
    /** Fetches the page and sends it. A failed refresh of a page already on screen is a toast, not a blank tab. */
    async load() {
        try {
            const session = await (0, githubAuth_1.getGithubSession)(false);
            const page = await (0, pullDetailApi_1.fetchPullPage)(this.repo.owner, this.repo.repo, this.pull.number, session?.accessToken ?? null);
            this.page = page;
            this.loadedAt = Date.now();
            this.panel.title = `#${page.number} ${shortTitle(page.title)}`;
            this.post({ type: 'page', page });
        }
        catch (err) {
            this.post({ type: this.page ? 'toast' : 'error', message: (0, pullModel_1.describeFailure)(err) });
        }
    }
    async rerun() {
        // The run ids come from the page this host loaded; the webview sends none.
        const ids = this.page ? (0, pullDetailModel_1.failedRunIds)(this.page.checks) : [];
        if (ids.length === 0)
            return;
        const session = await (0, githubAuth_1.getGithubSession)(true);
        if (!session) {
            this.post({ type: 'toast', message: 'Sign in to GitHub to re-run jobs.' });
        }
        else {
            const { started, errors } = await (0, pullDetailApi_1.rerunFailedRuns)(this.repo.owner, this.repo.repo, ids, session.accessToken);
            const startedText = started > 0 ? `Re-running the failed jobs of ${started} workflow run${started === 1 ? '' : 's'}.` : '';
            this.post({ type: 'toast', message: [startedText, ...errors].filter(Boolean).join(' ') });
        }
        await this.load(); // also re-enables the button
    }
    /** One write at a time: a second click (or a second button) while a dialog or request is open is dropped. */
    async act(action) {
        if (this.busy || !this.page)
            return;
        this.busy = true;
        try {
            const outcome = await (0, pullActions_1.runAction)(action, { ...this.repo, number: this.pull.number }, this.page);
            if (outcome === 'cancelled') {
                this.post({ type: 'page', page: this.page }); // same page again: re-enables the buttons
            }
            else {
                await this.load(); // a refusal can mean the PR changed (moved head, closed elsewhere): show it as it is now
                void vscode.commands.executeCommand('null.pulls.refresh'); // state icon, merged PRs leave the Open list
            }
        }
        finally {
            this.busy = false;
        }
    }
    async handle(msg) {
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
            case 'review':
            case 'merge':
            case 'close':
            case 'reopen':
            case 'ready':
            case 'draft':
                if (pullActions_1.PAGE_ACTIONS.has(msg.type))
                    await this.act(msg.type);
                break;
            case 'openExternal': {
                const url = (0, pullDetailModel_1.safeExternalUrl)(msg.url);
                if (url)
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                break;
            }
        }
    }
    buildHtml() {
        const nonce = (0, webviewUtils_1.getNonce)();
        const asUri = (file) => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
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
exports.PullDetailPanel = PullDetailPanel;
//# sourceMappingURL=pullDetailPanel.js.map