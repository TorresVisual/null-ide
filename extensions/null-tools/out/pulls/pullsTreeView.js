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
exports.PullsTreeProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const githubAuth_1 = require("../github/githubAuth");
const githubRemote_1 = require("../github/githubRemote");
const graphMessages_1 = require("../graph/graphMessages");
const gitRun_1 = require("../graph/gitRun");
const pullApi_1 = require("./pullApi");
const pullModel_1 = require("./pullModel");
const CHECK_COLORS = { success: 'charts.green', failure: 'charts.red', pending: 'charts.yellow', none: undefined };
const STATUS_LETTER = { added: 'A', removed: 'D', renamed: 'R', modified: 'M' };
class PullsTreeProvider {
    review;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    pulls = [];
    details = new Map();
    /** Outdated-thread counts of PRs whose detail has loaded; shown in the PR's tooltip. */
    outdated = new Map();
    repo = null;
    token = null;
    current = null;
    loaded = false;
    state = 'no-folder';
    /** The tree's one-line detail for the `error` state; undefined otherwise. */
    onMessage = () => undefined;
    constructor(review) {
        this.review = review;
    }
    async refresh() {
        this.loaded = true;
        this.details.clear();
        this.outdated.clear();
        this.review.clear();
        this.pulls = [];
        let message;
        this.state = await this.resolveState();
        if (this.state === 'ready') {
            try {
                this.pulls = (0, pullModel_1.pinCurrent)(await (0, pullApi_1.listOpenPulls)(this.repo.owner, this.repo.repo, this.token), this.current);
                this.state = this.pulls.length === 0 ? 'empty' : 'ready';
            }
            catch (err) {
                this.state = 'error';
                message = (0, pullModel_1.describeFailure)(err);
            }
        }
        void vscode.commands.executeCommand('setContext', 'null.pulls.state', this.state);
        this.onMessage(message);
        this.emitter.fire(undefined);
    }
    /** Everything that decides whether the list can be fetched at all, in the order the commit graph checks it. */
    async resolveState() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const blocked = (0, graphMessages_1.classifyWorkspace)({ folderScheme: folder?.uri.scheme, trusted: vscode.workspace.isTrusted });
        if (blocked)
            return blocked;
        const git = (0, gitRun_1.makeRunGit)(folder.uri.fsPath);
        if (!await git(['rev-parse', '--is-inside-work-tree']).then(() => true, () => false))
            return 'not-a-repo';
        // null on a detached HEAD: no PR is marked current
        this.current = await git(['symbolic-ref', '--short', '-q', 'HEAD']).then(out => out.trim() || null, () => null);
        this.repo = (0, githubRemote_1.getWorkspaceGithubRepo)(folder.uri.fsPath);
        if (!this.repo)
            return 'no-repo';
        const session = await (0, githubAuth_1.getGithubSession)(false);
        this.token = session?.accessToken ?? null;
        return session ? 'ready' : 'signed-out';
    }
    getTreeItem(node) {
        if (node.kind === 'file') {
            const { file, detail } = node;
            const item = new vscode.TreeItem(vscode.Uri.file(file.path), vscode.TreeItemCollapsibleState.None);
            const dir = path.posix.dirname(file.path);
            const threads = (0, pullModel_1.threadCount)(detail.threads, file.path);
            item.description = [STATUS_LETTER[file.status], dir === '.' ? '' : dir, `+${file.additions} −${file.deletions}`, threads ? `💬 ${threads}` : '']
                .filter(Boolean).join('  ');
            item.tooltip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
            item.contextValue = 'pullFile';
            item.id = `pull-${node.detail.pull.number}-${file.path}`;
            item.command = { command: 'null.pulls.openFileDiff', title: 'Open Diff', arguments: [node] };
            return item;
        }
        const { pull } = node;
        const item = new vscode.TreeItem(`#${pull.number} ${pull.title}`, vscode.TreeItemCollapsibleState.Collapsed);
        const color = CHECK_COLORS[pull.checks];
        item.iconPath = new vscode.ThemeIcon(pull.draft ? 'git-pull-request-draft' : 'git-pull-request', color ? new vscode.ThemeColor(color) : undefined);
        const isCurrent = this.current !== null && (0, pullModel_1.pullBranch)(pull) === this.current;
        item.description = `${isCurrent ? '● ' : ''}${pull.author} · ${pull.headRef} → ${pull.baseRef}`;
        const checks = pull.checks === 'none' ? 'no checks' : `checks ${pull.checks}`;
        const review = pull.review === 'none' ? '' : ` · ${pull.review === 'changes' ? 'changes requested' : pull.review}`;
        const outdated = this.outdated.get(pull.number);
        const hidden = outdated ? `\n${outdated} outdated thread${outdated === 1 ? '' : 's'} not shown` : '';
        item.tooltip = `${pull.title}\n#${pull.number} by ${pull.author}${pull.draft ? ' (draft)' : ''}\n${checks}${review}${hidden}`;
        item.contextValue = 'pull';
        item.id = `pull-${pull.number}`;
        return item;
    }
    async getChildren(node) {
        if (!node)
            return this.pulls.map(pull => ({ kind: 'pull', pull }));
        if (node.kind === 'file')
            return [];
        try {
            const detail = await this.detail(node.pull);
            if (detail.outdated && !this.outdated.has(node.pull.number)) {
                this.outdated.set(node.pull.number, detail.outdated);
                this.emitter.fire(node); // same id, so it stays expanded; only the tooltip changes
            }
            return detail.files.map(file => ({ kind: 'file', detail, file }));
        }
        catch (err) {
            this.details.delete(node.pull.number);
            void vscode.window.showErrorMessage(`Could not load #${node.pull.number}: ${(0, pullModel_1.describeFailure)(err)}`);
            return [];
        }
    }
    detail(pull) {
        let cached = this.details.get(pull.number);
        if (!cached) {
            cached = this.load(pull);
            this.details.set(pull.number, cached);
        }
        return cached;
    }
    async load(pull) {
        const repo = this.repo;
        if (!repo)
            throw new Error('This folder has no GitHub remote.'); // unreachable in `ready`; keeps the types honest
        const [files, mergeBase, threads] = await Promise.all([
            (0, pullApi_1.fetchPullFiles)(repo.owner, repo.repo, pull.number, this.token),
            (0, pullApi_1.fetchMergeBase)(repo.owner, repo.repo, pull.baseSha, pull.headSha, this.token),
            (0, pullApi_1.fetchReviewThreads)(repo.owner, repo.repo, pull.number, this.token),
        ]);
        const detail = { repo, pull, mergeBase, files, threads: threads.threads, outdated: threads.outdated };
        this.review.show(detail, threads.threads);
        return detail;
    }
}
exports.PullsTreeProvider = PullsTreeProvider;
//# sourceMappingURL=pullsTreeView.js.map