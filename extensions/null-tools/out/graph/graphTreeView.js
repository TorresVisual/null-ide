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
exports.GraphTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const gitLog_1 = require("./gitLog");
const TREE_COMMITS = 50;
/** The first 50 commits of the shared listing, loaded only while the view is visible. */
class GraphTreeProvider {
    session;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    elements = [];
    lease;
    subscription;
    constructor(session) {
        this.session = session;
        this.subscription = session.onDidChange(() => { if (this.lease)
            void this.load(); });
    }
    setVisible(visible) {
        if (visible && !this.lease) {
            this.lease = this.session.acquire();
            void this.load();
        }
        else if (!visible && this.lease) {
            this.lease.dispose();
            this.lease = undefined;
        }
    }
    async load() {
        const availability = await this.session.availability();
        if (!availability.ok) {
            this.elements = [];
        }
        else {
            try {
                await this.session.busy.whenIdle();
                const page = await availability.service.loadPage(0, TREE_COMMITS);
                this.elements = page.commits.map((c) => ({ sha: c.sha, subject: c.subject, author: c.author, time: c.time, refs: c.refs }));
                void this.session.prime();
            }
            catch {
                this.elements = []; // keep the view quiet; the tab shows load errors with a retry
            }
        }
        this.emitter.fire();
    }
    getTreeItem(element) {
        const item = new vscode.TreeItem(element.subject, vscode.TreeItemCollapsibleState.None);
        const badges = element.refs.map((r) => r.name).join(' ');
        item.description = [element.author, (0, gitLog_1.formatAge)(element.time, Date.now() / 1000), badges].filter(Boolean).join(' · ');
        item.tooltip = `${element.sha}\n${element.author}`;
        item.iconPath = new vscode.ThemeIcon('git-commit');
        item.contextValue = 'graphCommit';
        item.id = element.sha;
        item.command = { command: 'null.graph.open', title: 'Open Commit Graph', arguments: [element.sha] };
        return item;
    }
    getChildren() {
        return this.elements;
    }
    dispose() {
        this.lease?.dispose();
        this.subscription.dispose();
        this.emitter.dispose();
    }
}
exports.GraphTreeProvider = GraphTreeProvider;
//# sourceMappingURL=graphTreeView.js.map