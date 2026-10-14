/// <reference path="./protocol.ts" />
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
exports.CommitGraphPanel = void 0;
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const commitGraphHtml_1 = require("./commitGraphHtml");
const gitGraphService_1 = require("./gitGraphService");
const graphLayout_1 = require("./graphLayout");
const graphMessages_1 = require("./graphMessages");
const graphDiff_1 = require("./graphDiff");
const VIEW_TYPE = 'null.commitGraph';
const STALE_AFTER_MS = 60_000;
const MAX_FOCUS_PAGES = 20;
/** Owns the single, reused Commit Graph tab. The webview renders; every decision and every git call happens here. */
class CommitGraphPanel {
    context;
    session;
    panel;
    lease;
    disposables = [];
    layouter = new graphLayout_1.GraphLayouter();
    rows = [];
    nextSkip = 0;
    hasMore = false;
    generation = 0;
    loading;
    ready = false;
    pendingFocus;
    hiddenAt;
    latestSelect;
    detailCache;
    constructor(context, session) {
        this.context = context;
        this.session = session;
    }
    async reveal(sha) {
        if (sha)
            this.pendingFocus = sha;
        if (this.panel) {
            this.panel.reveal();
            if (sha && this.ready)
                await this.flushFocus();
            return;
        }
        const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
        const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Commit Graph', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [lib],
        });
        panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commit-graph.svg');
        this.panel = panel;
        this.ready = false;
        const asset = (file) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
        panel.webview.html = (0, commitGraphHtml_1.getCommitGraphHtml)(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('commitGraph.js'), asset('commitGraph.css'));
        this.lease = this.session.acquire();
        this.disposables.push(panel.webview.onDidReceiveMessage((raw) => void this.handleRaw(raw)), this.session.onDidChange(() => { if (this.ready)
            void this.reload(); }), panel.onDidChangeViewState((e) => {
            if (!e.webviewPanel.visible) {
                this.hiddenAt = Date.now();
                return;
            }
            if (this.hiddenAt !== undefined && Date.now() - this.hiddenAt > STALE_AFTER_MS)
                void this.session.checkNow();
            this.hiddenAt = undefined;
        }), panel.onDidDispose(() => this.closed()));
    }
    dispose() {
        this.panel?.dispose();
        this.closed();
    }
    closed() {
        this.panel = undefined;
        this.ready = false;
        this.generation++;
        this.rows = [];
        this.detailCache = undefined;
        this.latestSelect = undefined;
        this.lease?.dispose();
        this.lease = undefined;
        for (const d of this.disposables.splice(0))
            d.dispose();
    }
    /** Test seam (`_null.graph.snapshot`): what the tab currently holds. */
    snapshot() {
        return {
            open: this.panel !== undefined,
            rowCount: this.rows.length,
            headSha: this.rows.find((r) => r.refs.some((ref) => ref.current))?.sha,
            detailSha: this.detailCache?.sha,
        };
    }
    post(message) {
        void this.panel?.webview.postMessage(message);
    }
    /** Entry point for webview messages and for the `_null.graph.dispatch` test seam; untrusted input is validated first. */
    async handleRaw(raw) {
        const message = (0, graphMessages_1.parseWebviewMessage)(raw);
        if (!message)
            return;
        switch (message.type) {
            case 'ready':
                this.ready = true;
                await this.reload();
                break;
            case 'refresh':
                await this.reload();
                break;
            case 'loadMore':
                await this.loadMore();
                break;
            case 'select':
                await this.sendDetail(message.sha);
                break;
            case 'goto':
                await this.focus(message.sha);
                break;
            case 'openDiff':
                await this.openDiff(message.sha, message.file);
                break;
            case 'banner':
                await vscode.commands.executeCommand(`null.graph.${message.action}`);
                break;
            case 'manageTrust':
                await vscode.commands.executeCommand('workbench.trust.manage');
                break;
        }
    }
    async reload() {
        const generation = ++this.generation;
        const availability = await this.session.availability();
        if (!availability.ok) {
            this.post({ type: 'unavailable', reason: availability.reason });
            return;
        }
        try {
            await this.session.busy.whenIdle();
            const page = await availability.service.loadPage(0, gitGraphService_1.PAGE_SIZE);
            if (generation !== this.generation)
                return;
            this.layouter.reset();
            this.rows = this.layouter.layoutPage(page.commits);
            this.nextSkip = page.rawCount;
            this.hasMore = page.hasMore;
            this.post({ type: 'rows', rows: this.rows, hasMore: this.hasMore, reset: true });
            this.post({ type: 'state', inProgress: await availability.service.inProgress() });
            void this.session.prime();
            await this.flushFocus();
        }
        catch (err) {
            if (generation === this.generation)
                this.post({ type: 'loadError', message: errorText(err), retry: 'refresh' });
        }
    }
    loadMore() {
        return (this.loading ??= this.doLoadMore().finally(() => { this.loading = undefined; }));
    }
    async doLoadMore() {
        const generation = this.generation;
        const availability = await this.session.availability();
        if (!availability.ok || !this.hasMore)
            return;
        try {
            const page = await availability.service.loadPage(this.nextSkip, gitGraphService_1.PAGE_SIZE);
            if (generation !== this.generation)
                return;
            const fresh = this.layouter.layoutPage(page.commits);
            this.rows.push(...fresh);
            this.nextSkip += page.rawCount;
            this.hasMore = page.hasMore;
            this.post({ type: 'rows', rows: fresh, hasMore: this.hasMore, reset: false });
        }
        catch (err) {
            if (generation === this.generation)
                this.post({ type: 'loadError', message: errorText(err), retry: 'loadMore' });
        }
    }
    async flushFocus() {
        const sha = this.pendingFocus;
        this.pendingFocus = undefined;
        if (sha)
            await this.focus(sha);
    }
    /** Loads further pages until the commit is in the list (bounded), then asks the webview to select it. */
    async focus(sha) {
        for (let pages = 0; !this.rows.some((r) => r.sha === sha) && this.hasMore && pages < MAX_FOCUS_PAGES; pages++) {
            await this.loadMore();
        }
        if (this.rows.some((r) => r.sha === sha))
            this.post({ type: 'focus', sha });
        else
            void vscode.window.showInformationMessage('Commit Graph: that commit is not in the loaded history.');
    }
    async sendDetail(sha) {
        this.latestSelect = sha;
        const availability = await this.session.availability();
        if (!availability.ok)
            return;
        try {
            const detail = await availability.service.commitDetail(sha);
            if (this.latestSelect !== sha)
                return;
            this.post({ type: 'detail', detail });
            const parent = detail.parents[0];
            const files = await availability.service.commitFiles(sha, parent);
            if (this.latestSelect !== sha)
                return; // a newer selection owns the cache that openDiff validates against
            this.detailCache = { sha, parent, files };
            this.post({ type: 'files', sha, files });
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
        }
    }
    async openDiff(sha, filePath) {
        const cache = this.detailCache;
        const file = cache?.sha === sha ? cache.files.find((f) => f.path === filePath) : undefined;
        if (!cache || !file)
            return; // only files the host itself listed for this commit
        const availability = await this.session.availability().then((a) => (a.ok ? a : undefined));
        if (!availability)
            return;
        try {
            await (0, graphDiff_1.openFileDiff)(availability.root, sha, cache.parent, file);
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
        }
    }
}
exports.CommitGraphPanel = CommitGraphPanel;
function errorText(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=commitGraphPanel.js.map