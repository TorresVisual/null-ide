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
exports.ReportPanel = void 0;
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const reportHtml_1 = require("./reportHtml");
const reportModel_1 = require("./reportModel");
const VIEW_TYPE = 'null-startup.report';
const BASELINE_KEY = 'null-startup.report.baseline';
/** Owns the single, reused report tab. All data logic lives in reportModel.ts. */
class ReportPanel {
    context;
    store;
    slowMs;
    panel;
    selectedId;
    baseline;
    disposables = [];
    constructor(context, store, slowMs) {
        this.context = context;
        this.store = store;
        this.slowMs = slowMs;
        const saved = context.workspaceState.get(BASELINE_KEY);
        this.baseline = saved === 'median' || saved === 'none' ? saved : 'previous';
    }
    reveal() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
        const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Startup Performance', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [lib] });
        this.panel = panel;
        const asset = (file) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
        panel.webview.html = (0, reportHtml_1.getReportHtml)(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('report.js'), asset('report.css'));
        this.disposables.push(panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)), panel.onDidDispose(() => {
            this.panel = undefined;
            this.disposables.splice(0).forEach((d) => d.dispose());
        }));
    }
    /** Re-reads the history and pushes it if the tab is open. */
    refresh() {
        if (this.panel)
            void this.push();
    }
    /** The report the tab shows, or the newest one when the tab was never used. */
    async selectedReport() {
        const all = await this.store.list();
        return all.find((r) => r.id === this.selectedId) ?? all[0];
    }
    dispose() {
        this.panel?.dispose();
    }
    async push() {
        const history = await this.store.list();
        const message = { type: 'model', model: (0, reportModel_1.buildViewModel)(history, { selectedId: this.selectedId, baseline: this.baseline, slowMs: this.slowMs() }) };
        void this.panel?.webview.postMessage(message);
    }
    onMessage(raw) {
        const message = (0, reportModel_1.parseWebviewMessage)(raw);
        if (!message)
            return;
        switch (message.type) {
            case 'ready':
                void this.push();
                break;
            case 'select':
                this.selectedId = message.reportId;
                void this.push();
                break;
            case 'setBaseline':
                this.baseline = message.baseline;
                void this.context.workspaceState.update(BASELINE_KEY, message.baseline);
                void this.push();
                break;
            case 'copy':
                void vscode.commands.executeCommand('null-startup.copyReport');
                break;
            case 'export':
                void vscode.commands.executeCommand('null-startup.exportReport');
                break;
        }
    }
}
exports.ReportPanel = ReportPanel;
//# sourceMappingURL=reportPanel.js.map