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
exports.WorkflowLogProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("../github/githubApi");
const pullModel_1 = require("../pulls/pullModel");
const jobLog_1 = require("./jobLog");
const workflowLogDocs_1 = require("./workflowLogDocs");
const workflowsApi_1 = require("./workflowsApi");
const workflowsModel_1 = require("./workflowsModel");
const MAX_LINKS = 200;
const insideFolder = (folder, target) => {
    const rel = path.relative(folder, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
/**
 * Serves `null-workflows:` documents: one read-only tab per job (or per step). A job that is still running shows its steps
 * and whatever log text the endpoint returns, is refreshed on the poll tick, and stops being refreshed once it completes
 * or its tab closes. The provider has no timer of its own.
 */
class WorkflowLogProvider {
    ctx;
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    /** Documents whose job has not finished, by uri string. */
    live = new Map();
    /** The job's page on GitHub, for the truncation notice's link. */
    pages = new Map();
    constructor(ctx) {
        this.ctx = ctx;
    }
    hasLive() { return this.live.size > 0; }
    refreshLive() { for (const uri of this.live.values())
        this.changed.fire(uri); }
    forget(uri) {
        this.live.delete(uri.toString());
        this.pages.delete(uri.toString());
    }
    async provideTextDocumentContent(uri) {
        const ref = (0, workflowLogDocs_1.parseLogDoc)(uri.path, uri.query);
        if (!ref)
            return '';
        const token = this.ctx.tokenFor(ref.owner, ref.repo);
        const key = uri.toString();
        try {
            const job = await (0, workflowsApi_1.getJob)(ref.owner, ref.repo, ref.jobId, token);
            if ((0, workflowsModel_1.isActive)(job))
                this.live.set(key, uri);
            else
                this.live.delete(key);
            if (job.url)
                this.pages.set(key, job.url);
            let log = null;
            let gone = false;
            try {
                log = await (0, workflowsApi_1.fetchJobLog)(ref.owner, ref.repo, ref.jobId, token);
            }
            catch (err) {
                if (err instanceof githubApi_1.ApiError && err.status === 404)
                    gone = true;
                else if (!(0, workflowsModel_1.isActive)(job))
                    throw err; // a running job's log is best-effort
            }
            return (0, jobLog_1.renderJobDoc)({ job, log: log?.text ?? null, truncated: log?.truncated ?? false, step: ref.step, gone: gone && !(0, workflowsModel_1.isActive)(job), now: Date.now() });
        }
        catch (err) {
            this.live.delete(key);
            return `Could not load this log: ${(0, pullModel_1.describeFailure)(err)}`;
        }
    }
    /** Links `path:line` and `path(line,col)` in error/warning lines to workspace files that exist, and the truncation notice to GitHub. */
    async provideDocumentLinks(doc) {
        const ref = (0, workflowLogDocs_1.parseLogDoc)(doc.uri.path, doc.uri.query);
        if (!ref)
            return [];
        const out = [];
        const page = this.pages.get(doc.uri.toString());
        if (page && doc.lineCount > 0 && doc.lineAt(0).text === jobLog_1.TRUNCATED_NOTICE)
            out.push(new vscode.DocumentLink(doc.lineAt(0).range, vscode.Uri.parse(page)));
        const folder = this.ctx.folderFor(ref.owner, ref.repo);
        if (!folder)
            return out;
        const exists = new Map();
        for (let i = 0; i < doc.lineCount && out.length < MAX_LINKS; i++) {
            const text = doc.lineAt(i).text;
            if (!/##\[(error|warning)\]|\b(error|warning|fatal)\b/i.test(text))
                continue;
            for (const r of (0, jobLog_1.pathRefs)(text)) {
                const rel = (0, jobLog_1.repoRelative)(r.path);
                if (!rel)
                    continue;
                const target = vscode.Uri.joinPath(folder, rel);
                if (!insideFolder(folder.fsPath, target.fsPath))
                    continue;
                let ok = exists.get(target.fsPath);
                if (ok === undefined) {
                    ok = await vscode.workspace.fs.stat(target).then(() => true, () => false);
                    exists.set(target.fsPath, ok);
                }
                if (ok)
                    out.push(new vscode.DocumentLink(new vscode.Range(i, r.start, i, r.end), target.with({ fragment: `L${r.line}${r.col ? `,${r.col}` : ''}` })));
            }
        }
        return out;
    }
}
exports.WorkflowLogProvider = WorkflowLogProvider;
//# sourceMappingURL=workflowLogProvider.js.map