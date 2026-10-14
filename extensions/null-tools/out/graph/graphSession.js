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
exports.GraphSession = void 0;
const vscode = __importStar(require("vscode"));
const gitGraphService_1 = require("./gitGraphService");
const gitRun_1 = require("./gitRun");
const gitApi_1 = require("./gitApi");
const graphMessages_1 = require("./graphMessages");
const CHANGE_DEBOUNCE_MS = 500;
const ACTION_TIMEOUT_MS = 120_000;
/**
 * One per window. Resolves which repo the graph shows, shares one GitGraphService between the tab and the tree,
 * detects repository changes by fingerprint (the vscode.git event only triggers a check), and serializes actions.
 */
class GraphSession {
    busy = new gitRun_1.BusyFlag();
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    cached;
    consumers = 0;
    watchers = [];
    lastFingerprint;
    debounce;
    always;
    constructor() {
        this.always = [
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
        ];
    }
    availability() {
        return (this.cached ??= this.resolve());
    }
    async resolve() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const reason = (0, graphMessages_1.classifyWorkspace)({ folderScheme: folder?.uri.scheme, trusted: vscode.workspace.isTrusted });
        if (reason)
            return this.publish({ ok: false, reason });
        const found = await (0, gitGraphService_1.resolveRepoRoot)(folder.uri.fsPath);
        if (!found.ok)
            return this.publish({ ok: false, reason: found.reason });
        const read = (0, gitRun_1.makeRunGit)(found.root);
        return this.publish({ ok: true, root: found.root, service: new gitGraphService_1.GitGraphService(read, found.root), read, act: (0, gitRun_1.makeRunGit)(found.root, ACTION_TIMEOUT_MS) });
    }
    publish(availability) {
        void vscode.commands.executeCommand('setContext', 'null.graph.state', availability.ok ? 'ready' : availability.reason);
        return availability;
    }
    /** Forget the resolved repo (folders, trust or `git init` changed) and tell viewers to reload. */
    invalidate() {
        this.cached = undefined;
        this.lastFingerprint = undefined;
        this.stopWatching();
        if (this.consumers > 0)
            void this.startWatching();
        this.changed.fire();
    }
    /** A viewer (tab or visible tree) registers while it is showing; the change subscription runs only while one exists. */
    acquire() {
        if (++this.consumers === 1)
            void this.startWatching();
        let released = false;
        return {
            dispose: () => {
                if (released)
                    return;
                released = true;
                if (--this.consumers === 0)
                    this.stopWatching();
            },
        };
    }
    async startWatching() {
        try {
            const availability = await this.availability();
            const api = await (0, gitApi_1.getGitApi)();
            if (this.consumers === 0)
                return;
            const trigger = () => {
                if (this.debounce)
                    clearTimeout(this.debounce);
                this.debounce = setTimeout(() => void this.checkNow(), CHANGE_DEBOUNCE_MS);
            };
            if (!availability.ok) {
                this.watchers.push(api.onDidOpenRepository(() => this.invalidate()));
                return;
            }
            const repo = (0, gitApi_1.findRepository)(api, availability.root);
            this.watchers.push(repo ? repo.state.onDidChange(trigger) : api.onDidOpenRepository(trigger));
        }
        catch {
            // No git extension: viewers still work, they just refresh on focus and after actions.
        }
    }
    stopWatching() {
        if (this.debounce)
            clearTimeout(this.debounce);
        this.debounce = undefined;
        for (const watcher of this.watchers.splice(0))
            watcher.dispose();
    }
    async fingerprint() {
        const availability = await this.availability();
        if (!availability.ok)
            return undefined;
        const { hash, inProgress } = await availability.service.fingerprint();
        void vscode.commands.executeCommand('setContext', 'null.graph.operationInProgress', inProgress !== null);
        return hash;
    }
    /** Records the current fingerprint after a viewer loaded, without announcing a change. */
    async prime() {
        try {
            this.lastFingerprint = await this.fingerprint();
        }
        catch { /* transient git failure */ }
    }
    /** Announces a change when the fingerprint differs from the last one seen (or always with `force`). */
    async checkNow(force = false) {
        try {
            const hash = await this.fingerprint();
            if (hash === undefined)
                return;
            const changed = this.lastFingerprint !== undefined && hash !== this.lastFingerprint;
            this.lastFingerprint = hash;
            if (force || changed)
                this.changed.fire();
        }
        catch {
            // A transient failure keeps the last view; the next trigger retries.
        }
    }
    /** Runs one history-changing action: one at a time, refused during another operation unless allowed. */
    async runAction(fn, opts = {}) {
        const availability = await this.availability();
        if (!availability.ok)
            return { ok: false, message: (0, graphMessages_1.unavailableText)(availability.reason) };
        if (!opts.duringOperation) {
            const operation = await availability.service.inProgress();
            if (operation)
                return { ok: false, message: `A ${operation.kind} is in progress. Continue or abort it first.` };
        }
        const outcome = await this.busy.run(() => fn(availability));
        if (!outcome.ran)
            return { ok: false, message: 'Another Commit Graph action is still running.' };
        await this.checkNow(true);
        return outcome.value;
    }
    dispose() {
        this.stopWatching();
        for (const d of this.always)
            d.dispose();
        this.changed.dispose();
    }
}
exports.GraphSession = GraphSession;
//# sourceMappingURL=graphSession.js.map