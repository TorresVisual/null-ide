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
exports.DashboardPanel = void 0;
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const dashboardModel_1 = require("./dashboardModel");
const dashboardHtml_1 = require("./dashboardHtml");
const gitExec_1 = require("./gitExec");
const gitStatsService_1 = require("./gitStatsService");
const projectIdentity_1 = require("./projectIdentity");
const VIEW_TYPE = 'null-activity.dashboard';
const RANGE_KEY = 'null-activity.dashboard.range';
const THROTTLE_MS = 1_000;
const REFRESH_MS = 60_000;
/** Owns the single, reused dashboard tab. All data logic lives in dashboardModel.ts. */
class DashboardPanel {
    context;
    service;
    log;
    panel;
    range;
    lastPush = 0;
    pending;
    openDisposables = [];
    gitStats;
    /** `from:to` of the git load in progress, so the 1 s push throttle does not start a second one. */
    loadingGit;
    constructor(context, service, log) {
        this.context = context;
        this.service = service;
        this.log = log;
        const saved = context.workspaceState.get(RANGE_KEY);
        this.range = (0, dashboardModel_1.isDashboardRange)(saved) ? saved : 'today';
        this.gitStats = new gitStatsService_1.GitStatsService({
            folders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
            trusted: () => vscode.workspace.isTrusted,
            resolveKey: (folder) => (0, projectIdentity_1.resolveProject)(folder).key,
            exec: gitExec_1.execGit,
            now: () => Date.now(),
            log: (message) => this.log(message),
        });
    }
    reveal() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
        const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Coding Activity', vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [lib],
        });
        panel.iconPath = {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'activity-light.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'activity-dark.svg'),
        };
        this.panel = panel;
        const asset = (file) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
        panel.webview.html = (0, dashboardHtml_1.getDashboardHtml)(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('dashboard.js'), asset('dashboard.css'));
        const refresh = setInterval(() => this.push(), REFRESH_MS);
        this.openDisposables.push({ dispose: () => clearInterval(refresh) }, panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)), this.service.onDidChange(() => this.schedulePush()), 
        // Enabling tracking from the banner (or in settings) changes `enabled`, which the service does not announce.
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('null-activity'))
                this.schedulePush();
        }));
        // With retainContextWhenHidden off the page reloads when the tab is shown again and sends `ready`,
        // so no push on visibility change is needed.
        panel.onDidDispose(() => this.closed(), undefined, this.openDisposables);
    }
    dispose() {
        this.panel?.dispose();
        this.closed();
    }
    closed() {
        this.panel = undefined;
        if (this.pending)
            clearTimeout(this.pending);
        this.pending = undefined;
        for (const d of this.openDisposables.splice(0))
            d.dispose();
    }
    onMessage(raw) {
        const message = (0, dashboardModel_1.parseWebviewMessage)(raw);
        if (!message)
            return;
        switch (message.type) {
            case 'ready':
                this.push();
                break;
            case 'setRange':
                this.range = message.range;
                void this.context.workspaceState.update(RANGE_KEY, message.range);
                this.push();
                break;
            case 'enableTracking':
                void vscode.workspace.getConfiguration('null-activity').update('enabled', true, vscode.ConfigurationTarget.Global);
                break;
            case 'showTrackedData':
                void vscode.commands.executeCommand('null-activity.showTrackedData');
                break;
            case 'openSettings':
                void vscode.commands.executeCommand('workbench.action.openSettings', 'null-activity');
                break;
        }
    }
    /** At most one push per THROTTLE_MS; a change inside the window schedules one trailing push. */
    schedulePush() {
        if (this.pending)
            return;
        const wait = Math.max(0, THROTTLE_MS - (Date.now() - this.lastPush));
        this.pending = setTimeout(() => {
            this.pending = undefined;
            this.push();
        }, wait);
    }
    /** Builds and posts a snapshot; does nothing while the tab is hidden or closed. A failure keeps the previous model on screen. */
    push() {
        const panel = this.panel;
        if (!panel || !panel.visible)
            return;
        this.lastPush = Date.now();
        try {
            const now = Date.now();
            const dateRange = (0, dashboardModel_1.rangeFor)(this.range, now);
            // Stale numbers are better than none: they stay on screen while a reload runs.
            const { fresh, git } = this.gitStats.peek(dateRange);
            const message = {
                type: 'model',
                model: (0, dashboardModel_1.buildDashboardModel)(this.service, this.range, now, this.service.enabled, git),
            };
            void panel.webview.postMessage(message);
            if (!fresh)
                void this.refreshGit(dateRange);
        }
        catch (err) {
            this.log(`dashboard: could not build the model (${err instanceof Error ? err.message : String(err)})`);
        }
    }
    /**
     * Loads git data for `range`, then pushes again for whatever range is selected by then: the load only
     * warms the cache, so a range change mid-load can never show another range's numbers. `load` never
     * rejects and stores failures too, so this cannot loop.
     */
    async refreshGit(range) {
        const id = `${range.from}:${range.to}`;
        if (this.loadingGit === id)
            return;
        this.loadingGit = id;
        try {
            await this.gitStats.load(range);
        }
        finally {
            if (this.loadingGit === id)
                this.loadingGit = undefined;
        }
        if (this.panel)
            this.push();
    }
}
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map