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
exports.WorkflowsTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("../github/githubApi");
const githubAuth_1 = require("../github/githubAuth");
const githubRemote_1 = require("../github/githubRemote");
const githubSession_1 = require("../github/githubSession");
const gitRun_1 = require("../graph/gitRun");
const graphMessages_1 = require("../graph/graphMessages");
const pullModel_1 = require("../pulls/pullModel");
const dispatchInputs_1 = require("./dispatchInputs");
const api = __importStar(require("./workflowsApi"));
const workflowsModel_1 = require("./workflowsModel");
const FILTER_KEY = 'null.workflows.filter';
const MAX_WORKFLOW_BYTES = 256 * 1024;
const DETECT_PARALLEL = 20;
const group = (repo, g) => ({ kind: 'group', repo, group: g });
const ref = (s) => ({ key: s.key, owner: s.owner, repo: s.repo });
class WorkflowsTreeProvider {
    store;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    loadedEmitter = new vscode.EventEmitter();
    onDidLoad = this.loadedEmitter.event;
    all = [];
    refreshing = null;
    loaded = false;
    state = 'no-folder';
    filter;
    /** The tree's one-line detail: a rate-limit notice, otherwise the active filter. */
    onMessage = () => undefined;
    constructor(store) {
        this.store = store;
        this.filter = (0, workflowsModel_1.parseFilter)(store.get(FILTER_KEY));
    }
    slots() { return this.all; }
    slot(key) { return this.all.find(s => s.key === key); }
    slotForRepo(owner, repo) {
        return this.slot(`${owner}/${repo}`.toLowerCase()) ?? this.all.find(s => s.owner === owner && s.repo === repo);
    }
    async setFilter(next) {
        this.filter = next;
        await this.store.update(FILTER_KEY, (0, workflowsModel_1.isDefaultFilter)(next) ? undefined : next);
        await this.refresh();
    }
    ensureLoaded() {
        return this.loaded ? (this.refreshing ?? Promise.resolve()) : this.refresh();
    }
    /** Concurrent callers (a visibility event and a command) share one fetch. */
    refresh() {
        this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
        return this.refreshing;
    }
    async doRefresh() {
        this.loaded = true;
        const resolved = await this.resolve();
        this.state = resolved.state;
        this.all = resolved.slots;
        if (this.state === 'ready')
            await Promise.all(this.all.map(s => this.load(s)));
        // One repo and it failed outright: the whole view says so (with Try Again); several repos each show their own row.
        if (this.state === 'ready' && this.all.length === 1 && this.all[0].failures > 0 && this.all[0].runs.length === 0)
            this.state = 'error';
        void vscode.commands.executeCommand('setContext', 'null.workflows.state', this.state);
        this.publish();
    }
    publish() {
        this.onMessage(this.message());
        this.emitter.fire(undefined);
        this.loadedEmitter.fire();
    }
    message() {
        const now = Date.now();
        const limited = this.all.find(s => s.retryAt !== null && s.retryAt > now);
        const parts = [limited ? limited.error : undefined, (0, workflowsModel_1.isDefaultFilter)(this.filter) ? undefined : (0, workflowsModel_1.describeFilter)(this.filter)];
        return parts.filter(Boolean).join(' — ') || undefined;
    }
    /** Everything that decides whether any repo can be listed at all: workspace kind, git, a github.com `origin`. */
    async resolve() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const blocked = (0, graphMessages_1.classifyWorkspace)({ folderScheme: folders[0]?.uri.scheme, trusted: vscode.workspace.isTrusted });
        if (blocked)
            return { state: blocked, slots: [] };
        const found = [];
        let sawRepo = false;
        let gitMissing = false;
        for (const folder of folders.filter(f => f.uri.scheme === 'file')) {
            const git = (0, gitRun_1.makeRunGit)(folder.uri.fsPath);
            try {
                await git(['rev-parse', '--is-inside-work-tree']);
            }
            catch (err) {
                if (err instanceof gitRun_1.GitError && err.code === 'ENOENT')
                    gitMissing = true;
                continue;
            }
            sawRepo = true;
            const origin = (0, githubRemote_1.getWorkspaceGithubRepo)(folder.uri.fsPath);
            if (!origin)
                continue;
            const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).then(out => out.trim() || null, () => null);
            const repo = { key: `${origin.owner}/${origin.repo}`.toLowerCase(), owner: origin.owner, repo: origin.repo };
            found.push({ repo, slot: this.newSlot(repo, folder.uri, branch) });
        }
        const slots = (0, workflowsModel_1.dedupeRepos)(found).map(f => f.slot);
        if (slots.length > 0)
            return { state: 'ready', slots };
        return { state: gitMissing ? 'no-git' : sawRepo ? 'no-repo' : 'not-a-repo', slots: [] };
    }
    newSlot(repo, folder, branch) {
        return {
            ...repo, folder, token: null, login: null, branch, runs: [], runsTotal: 0, runsPage: 1, workflows: [], workflowsTotal: 0,
            dispatchable: new Map(), jobs: new Map(), pinned: null, failures: 0, retryAt: null, error: null,
        };
    }
    ctx(s) { return { branch: s.branch, login: s.login }; }
    async load(slot) {
        const session = await (0, githubSession_1.resolveGithubSession)((0, githubAuth_1.getAccountsApi)(), slot.folder, false);
        slot.token = session?.accessToken ?? null;
        slot.login = session?.login ?? null;
        if (!slot.token)
            return; // the sign-in row; never a silent empty tree
        try {
            const [runs, workflows] = await Promise.all([
                api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token),
                api.listWorkflows(slot.owner, slot.repo, slot.token),
            ]);
            slot.runs = runs.runs;
            slot.runsTotal = runs.total;
            slot.runsPage = 1;
            slot.workflows = workflows.workflows;
            slot.workflowsTotal = workflows.total;
            slot.error = null;
            slot.failures = 0;
            slot.retryAt = null;
            void this.detectDispatchable(slot);
        }
        catch (err) {
            this.fail(slot, err);
        }
    }
    /** Records a failed fetch on the slot: a stale token becomes the sign-in row, a rate limit suspends polling, the rest back off. */
    fail(slot, err) {
        if (err instanceof githubApi_1.ApiError && err.status === 401) {
            slot.token = null;
            return;
        }
        if (err instanceof githubApi_1.ApiError && err.retryAt !== null) {
            slot.retryAt = err.retryAt;
            slot.error = (0, pullModel_1.describeFailure)(err);
            return;
        }
        slot.failures++;
        slot.error = err instanceof githubApi_1.ApiError && err.status === 404
            ? 'GitHub cannot see this repository: it is private and this account has no access, or it was renamed.'
            : (0, pullModel_1.describeFailure)(err);
    }
    /** Reads each active workflow file at the default branch (max 20 at a time) to learn which can be dispatched. */
    async detectDispatchable(slot) {
        let ref;
        try {
            ref = await api.getDefaultBranch(slot.owner, slot.repo, slot.token);
        }
        catch {
            return;
        }
        await (0, workflowsModel_1.mapLimit)(slot.workflows.filter(w => w.state === 'active'), DETECT_PARALLEL, async (w) => {
            try {
                const file = await (0, githubApi_1.fetchRepoFile)(slot.owner, slot.repo, ref, w.path, slot.token, MAX_WORKFLOW_BYTES);
                slot.dispatchable.set(w.id, (0, dispatchInputs_1.parseDispatch)(file.bytes.toString('utf8')).dispatchable);
            }
            catch {
                slot.dispatchable.set(w.id, false); // unreadable means "not dispatchable": the action is hidden, not an error
            }
        });
        this.emitter.fire(undefined);
    }
    /** Re-fetches the first page of runs and merges it over what is loaded; keeps expanded jobs and loaded pages. */
    async reloadRuns(slot) {
        if (!slot.token)
            return;
        try {
            const wasActive = new Set(slot.runs.filter(workflowsModel_1.isActive).map(r => r.id));
            const fresh = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token);
            slot.runs = (0, workflowsModel_1.mergeRuns)(fresh.runs, slot.runs);
            slot.runsTotal = fresh.total;
            slot.error = null;
            slot.failures = 0;
            slot.retryAt = null;
            // Jobs of expanded runs that are in play, or just finished, ride the same tick; finished runs' jobs never change.
            const stale = [...slot.jobs.keys()].filter(id => wasActive.has(id) || slot.runs.some(r => r.id === id && (0, workflowsModel_1.isActive)(r)));
            await Promise.all(stale.map(async (id) => { slot.jobs.set(id, await api.listJobs(slot.owner, slot.repo, id, slot.token)); }));
        }
        catch (err) {
            this.fail(slot, err);
        }
        this.publish();
    }
    async loadMore(slot) {
        if (!slot.token)
            return;
        try {
            const next = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), slot.runsPage + 1, slot.token);
            slot.runsPage++;
            slot.runs = (0, workflowsModel_1.mergeRuns)(slot.runs, next.runs);
            slot.runsTotal = next.total;
        }
        catch (err) {
            this.fail(slot, err);
        }
        this.publish();
    }
    /** The branch can change without a refetch: only the ● marker moves. */
    async refreshBranches() {
        let changed = false;
        for (const s of this.all) {
            const branch = await (0, gitRun_1.makeRunGit)(s.folder.fsPath)(['symbolic-ref', '--short', '-q', 'HEAD']).then(o => o.trim() || null, () => null);
            if (branch !== s.branch) {
                s.branch = branch;
                changed = true;
            }
        }
        if (changed)
            this.emitter.fire(undefined);
    }
    hasActiveRuns() { return this.all.some(s => s.token !== null && s.runs.some(workflowsModel_1.isActive)); }
    /** Shows `run` under a "Pinned" position of its repo until the next refresh (used by Reveal from the PR tab). */
    pin(slot, run) {
        if (!slot.runs.some(r => r.id === run.id))
            slot.pinned = run;
        this.emitter.fire(undefined);
    }
    snapshot() {
        return { state: this.state, repos: this.all.map(s => ({ runs: s.runs.length, workflows: s.workflows.length })) };
    }
    // ── TreeDataProvider ──────────────────────────────────────────────────────
    getParent(node) {
        const repo = node.repo;
        // With one repo the root node is omitted, so its groups are the roots.
        const top = this.all.length > 1 ? { kind: 'repo', repo } : undefined;
        switch (node.kind) {
            case 'repo': return undefined;
            case 'group':
            case 'signin':
            case 'error': return top;
            case 'note': return node.id === 'no-workflows' ? group(repo, 'workflows') : group(repo, 'runs');
            case 'run':
            case 'more': return group(repo, 'runs');
            case 'workflow': return group(repo, 'workflows');
            case 'job': return { kind: 'run', repo, run: node.run };
            case 'step': return { kind: 'job', repo, run: node.run, job: node.job };
        }
    }
    getTreeItem(node) {
        const state = (c) => c === 'none' ? vscode.TreeItemCollapsibleState.None
            : c === 'collapsed' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
        const slot = this.slot(node.repo.key);
        switch (node.kind) {
            case 'run':
            case 'job':
            case 'step':
            case 'workflow': {
                const view = (0, workflowsModel_1.describeNode)(node, { now: Date.now(), branch: slot?.branch ?? null });
                const item = new vscode.TreeItem(view.label, state(view.collapsible));
                item.id = view.id;
                item.description = view.description;
                item.tooltip = view.tooltip;
                item.iconPath = new vscode.ThemeIcon(view.icon.icon, view.icon.color ? new vscode.ThemeColor(view.icon.color) : undefined);
                item.contextValue = view.context;
                if (node.kind === 'job' || node.kind === 'step')
                    item.command = { command: 'null.workflows.openLog', title: 'Open Log', arguments: [node] };
                if (node.kind === 'workflow')
                    item.command = { command: 'null.workflows.openWorkflowFile', title: 'Open Workflow File', arguments: [node] };
                return item;
            }
            case 'repo': {
                const item = new vscode.TreeItem(`${node.repo.owner}/${node.repo.repo}`, vscode.TreeItemCollapsibleState.Expanded);
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon('repo');
                item.contextValue = 'repo';
                return item;
            }
            case 'signin': {
                const item = new vscode.TreeItem('Sign in to GitHub for this folder');
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon('account');
                item.command = { command: 'null.workflows.signIn', title: 'Sign In', arguments: [node] };
                return item;
            }
            case 'error': {
                const item = new vscode.TreeItem(node.text);
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
                item.description = 'Try Again';
                item.command = { command: 'null.workflows.refresh', title: 'Try Again' };
                return item;
            }
            case 'note': {
                const item = new vscode.TreeItem(node.text);
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon('info');
                item.contextValue = 'note';
                if (node.command)
                    item.command = { command: node.command, title: node.text, arguments: [node] };
                return item;
            }
            case 'group': {
                const runs = node.group === 'runs';
                const item = new vscode.TreeItem(runs ? 'Runs' : 'Workflows', runs ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon(runs ? 'history' : 'file-code');
                if (!runs && slot && slot.workflowsTotal > slot.workflows.length)
                    item.description = `first ${slot.workflows.length}`;
                return item;
            }
            case 'more': {
                const item = new vscode.TreeItem('Load more…');
                item.id = (0, workflowsModel_1.nodeId)(node);
                item.iconPath = new vscode.ThemeIcon('ellipsis');
                item.command = { command: 'null.workflows.loadMore', title: 'Load More', arguments: [node] };
                return item;
            }
        }
    }
    async getChildren(node) {
        if (!node) {
            if (this.state !== 'ready')
                return [];
            if (this.all.length === 1)
                return this.repoChildren(this.all[0]);
            return this.all.map(s => ({ kind: 'repo', repo: ref(s) }));
        }
        const slot = this.slot(node.repo.key);
        if (!slot)
            return [];
        switch (node.kind) {
            case 'repo': return this.repoChildren(slot);
            case 'group': return node.group === 'runs' ? this.runNodes(slot) : this.workflowNodes(slot);
            case 'run': return this.jobNodes(slot, node);
            case 'job': return node.job.steps.map(step => ({ kind: 'step', repo: node.repo, run: node.run, job: node.job, step }));
            default: return [];
        }
    }
    repoChildren(slot) {
        const repo = ref(slot);
        if (!slot.token)
            return [{ kind: 'signin', repo }];
        if (slot.error && slot.runs.length === 0 && slot.workflows.length === 0)
            return [{ kind: 'error', repo, text: slot.error }];
        const rows = [group(repo, 'runs'), group(repo, 'workflows')];
        return slot.failures >= 3 && slot.error ? [{ kind: 'error', repo, text: slot.error }, ...rows] : rows;
    }
    runNodes(slot) {
        const repo = ref(slot);
        const rows = [];
        if (slot.pinned)
            rows.push({ kind: 'run', repo, run: slot.pinned });
        rows.push(...slot.runs.map((run) => ({ kind: 'run', repo, run })));
        if (slot.runs.length === 0 && !slot.pinned)
            rows.push({ kind: 'note', repo, id: 'no-runs', text: (0, workflowsModel_1.isDefaultFilter)(this.filter) ? 'No runs yet' : 'No runs match the filter' });
        if (slot.runs.length < slot.runsTotal)
            rows.push({ kind: 'more', repo });
        return rows;
    }
    workflowNodes(slot) {
        const repo = ref(slot);
        if (slot.workflows.length === 0)
            return [{ kind: 'note', repo, id: 'no-workflows', text: 'No workflows yet', command: 'null.workflows.createWorkflow' }];
        return slot.workflows.map((workflow) => ({ kind: 'workflow', repo, workflow, dispatchable: slot.dispatchable.get(workflow.id) === true }));
    }
    async jobNodes(slot, node) {
        let jobs = slot.jobs.get(node.run.id);
        if (!jobs) {
            try {
                jobs = await api.listJobs(slot.owner, slot.repo, node.run.id, slot.token);
                slot.jobs.set(node.run.id, jobs);
            }
            catch (err) {
                this.fail(slot, err);
                return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: `Could not load jobs: ${(0, pullModel_1.describeFailure)(err)}` }];
            }
        }
        if (jobs.length === 0)
            return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: 'Waiting for jobs…' }];
        return jobs.map((job) => ({ kind: 'job', repo: node.repo, run: node.run, job }));
    }
}
exports.WorkflowsTreeProvider = WorkflowsTreeProvider;
//# sourceMappingURL=workflowsTreeView.js.map