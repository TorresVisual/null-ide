'use strict';

import * as vscode from 'vscode';
import { fetchRepoFile, ApiError } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { getWorkspaceGithubRepo } from '../github/githubRemote';
import { resolveGithubSession } from '../github/githubSession';
import { GitError, makeRunGit } from '../graph/gitRun';
import { classifyWorkspace } from '../graph/graphMessages';
import { describeFailure } from '../pulls/pullModel';
import { parseDispatch } from './dispatchInputs';
import * as api from './workflowsApi';
import {
  RepoRef, RunFilter, WfNode, Workflow, WorkflowJob, WorkflowRun, dedupeRepos, describeFilter, describeNode, isActive,
  isDefaultFilter, mapLimit, mergeRuns, nodeId, parseFilter, pollDelay,
} from './workflowsModel';

/** What the view shows; every value except `ready` has a welcome message in package.json (`null.workflows.state`). */
export type WorkflowsState = 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git' | 'no-repo' | 'error' | 'ready';

export interface RepoSlot extends RepoRef {
  folder: vscode.Uri;
  token: string | null;
  login: string | null;
  branch: string | null;
  runs: WorkflowRun[]; runsTotal: number; runsPage: number;
  workflows: Workflow[]; workflowsTotal: number;
  /** Workflow id → has a `workflow_dispatch` trigger (read from the YAML at the default branch). */
  dispatchable: Map<number, boolean>;
  /** Run id → its jobs, once the run has been expanded. */
  jobs: Map<number, WorkflowJob[]>;
  /** A run revealed from the PR tab that is not among the loaded ones; dropped on the next refresh. */
  pinned: WorkflowRun | null;
  /** Consecutive failed fetches (back-off input); three show an error row. */
  failures: number;
  retryAt: number | null;
  error: string | null;
}

const FILTER_KEY = 'null.workflows.filter';
const MAX_WORKFLOW_BYTES = 256 * 1024;
const DETECT_PARALLEL = 20;
const group = (repo: RepoRef, g: 'runs' | 'workflows'): WfNode => ({ kind: 'group', repo, group: g });
const ref = (s: RepoSlot): RepoRef => ({ key: s.key, owner: s.owner, repo: s.repo });

export class WorkflowsTreeProvider implements vscode.TreeDataProvider<WfNode> {
  private readonly emitter = new vscode.EventEmitter<WfNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly loadedEmitter = new vscode.EventEmitter<void>();
  readonly onDidLoad = this.loadedEmitter.event;
  private all: RepoSlot[] = [];
  private refreshing: Promise<void> | null = null;

  loaded = false;
  state: WorkflowsState = 'no-folder';
  filter: RunFilter;
  /** The tree's one-line detail: a rate-limit notice, otherwise the active filter. */
  onMessage: (message: string | undefined) => void = () => undefined;

  constructor(private readonly store: vscode.Memento) {
    this.filter = parseFilter(store.get(FILTER_KEY));
  }

  slots(): RepoSlot[] { return this.all; }
  slot(key: string): RepoSlot | undefined { return this.all.find(s => s.key === key); }
  slotForRepo(owner: string, repo: string): RepoSlot | undefined {
    return this.slot(`${owner}/${repo}`.toLowerCase()) ?? this.all.find(s => s.owner === owner && s.repo === repo);
  }

  async setFilter(next: RunFilter): Promise<void> {
    this.filter = next;
    await this.store.update(FILTER_KEY, isDefaultFilter(next) ? undefined : next);
    await this.refresh();
  }

  ensureLoaded(): Promise<void> {
    return this.loaded ? (this.refreshing ?? Promise.resolve()) : this.refresh();
  }

  /** Concurrent callers (a visibility event and a command) share one fetch. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    this.loaded = true;
    const resolved = await this.resolve();
    this.state = resolved.state;
    this.all = resolved.slots;
    if (this.state === 'ready') await Promise.all(this.all.map(s => this.load(s)));
    // One repo and it failed outright: the whole view says so (with Try Again); several repos each show their own row.
    if (this.state === 'ready' && this.all.length === 1 && this.all[0].failures > 0 && this.all[0].runs.length === 0) this.state = 'error';
    void vscode.commands.executeCommand('setContext', 'null.workflows.state', this.state);
    this.publish();
  }

  private publish(): void {
    this.onMessage(this.message());
    this.emitter.fire(undefined);
    this.loadedEmitter.fire();
  }

  private message(): string | undefined {
    const now = Date.now();
    const limited = this.all.find(s => s.retryAt !== null && s.retryAt > now);
    const parts = [limited ? limited.error : undefined, isDefaultFilter(this.filter) ? undefined : describeFilter(this.filter)];
    return parts.filter(Boolean).join(' — ') || undefined;
  }

  /** Everything that decides whether any repo can be listed at all: workspace kind, git, a github.com `origin`. */
  private async resolve(): Promise<{ state: WorkflowsState; slots: RepoSlot[] }> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const blocked = classifyWorkspace({ folderScheme: folders[0]?.uri.scheme, trusted: vscode.workspace.isTrusted });
    if (blocked) return { state: blocked, slots: [] };
    const found: Array<{ repo: RepoRef; slot: RepoSlot }> = [];
    let sawRepo = false;
    let gitMissing = false;
    for (const folder of folders.filter(f => f.uri.scheme === 'file')) {
      const git = makeRunGit(folder.uri.fsPath);
      try {
        await git(['rev-parse', '--is-inside-work-tree']);
      } catch (err) {
        if (err instanceof GitError && err.code === 'ENOENT') gitMissing = true;
        continue;
      }
      sawRepo = true;
      const origin = getWorkspaceGithubRepo(folder.uri.fsPath);
      if (!origin) continue;
      const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).then(out => out.trim() || null, () => null);
      const repo: RepoRef = { key: `${origin.owner}/${origin.repo}`.toLowerCase(), owner: origin.owner, repo: origin.repo };
      found.push({ repo, slot: this.newSlot(repo, folder.uri, branch) });
    }
    const slots = dedupeRepos(found).map(f => f.slot);
    if (slots.length > 0) return { state: 'ready', slots };
    return { state: gitMissing ? 'no-git' : sawRepo ? 'no-repo' : 'not-a-repo', slots: [] };
  }

  private newSlot(repo: RepoRef, folder: vscode.Uri, branch: string | null): RepoSlot {
    return {
      ...repo, folder, token: null, login: null, branch, runs: [], runsTotal: 0, runsPage: 1, workflows: [], workflowsTotal: 0,
      dispatchable: new Map(), jobs: new Map(), pinned: null, failures: 0, retryAt: null, error: null,
    };
  }

  private ctx(s: RepoSlot): { branch: string | null; login: string | null } { return { branch: s.branch, login: s.login }; }

  private async load(slot: RepoSlot): Promise<void> {
    const session = await resolveGithubSession(getAccountsApi(), slot.folder, false);
    slot.token = session?.accessToken ?? null;
    slot.login = session?.login ?? null;
    if (!slot.token) return; // the sign-in row; never a silent empty tree
    try {
      const [runs, workflows] = await Promise.all([
        api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token),
        api.listWorkflows(slot.owner, slot.repo, slot.token),
      ]);
      slot.runs = runs.runs; slot.runsTotal = runs.total; slot.runsPage = 1;
      slot.workflows = workflows.workflows; slot.workflowsTotal = workflows.total;
      slot.error = null; slot.failures = 0; slot.retryAt = null;
      void this.detectDispatchable(slot);
    } catch (err) {
      this.fail(slot, err);
    }
  }

  /** Records a failed fetch on the slot: a stale token becomes the sign-in row, a rate limit suspends polling, the rest back off. */
  fail(slot: RepoSlot, err: unknown): void {
    if (err instanceof ApiError && err.status === 401) { slot.token = null; return; }
    if (err instanceof ApiError && err.retryAt !== null) {
      slot.retryAt = err.retryAt;
      slot.error = describeFailure(err);
      return;
    }
    slot.failures++;
    slot.error = err instanceof ApiError && err.status === 404
      ? 'GitHub cannot see this repository: it is private and this account has no access, or it was renamed.'
      : describeFailure(err);
  }

  /** Reads each active workflow file at the default branch (max 20 at a time) to learn which can be dispatched. */
  private async detectDispatchable(slot: RepoSlot): Promise<void> {
    let ref: string;
    try {
      ref = await api.getDefaultBranch(slot.owner, slot.repo, slot.token);
    } catch {
      return;
    }
    await mapLimit(slot.workflows.filter(w => w.state === 'active'), DETECT_PARALLEL, async w => {
      try {
        const file = await fetchRepoFile(slot.owner, slot.repo, ref, w.path, slot.token, MAX_WORKFLOW_BYTES);
        slot.dispatchable.set(w.id, parseDispatch(file.bytes.toString('utf8')).dispatchable);
      } catch {
        slot.dispatchable.set(w.id, false); // unreadable means "not dispatchable": the action is hidden, not an error
      }
    });
    this.emitter.fire(undefined);
  }

  /** Re-fetches the first page of runs and merges it over what is loaded; keeps expanded jobs and loaded pages. */
  async reloadRuns(slot: RepoSlot): Promise<void> {
    if (!slot.token) return;
    try {
      const wasActive = new Set(slot.runs.filter(isActive).map(r => r.id));
      const fresh = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token);
      slot.runs = mergeRuns(fresh.runs, slot.runs);
      slot.runsTotal = fresh.total;
      slot.error = null; slot.failures = 0; slot.retryAt = null;
      // Jobs of expanded runs that are in play, or just finished, ride the same tick; finished runs' jobs never change.
      const stale = [...slot.jobs.keys()].filter(id => wasActive.has(id) || slot.runs.some(r => r.id === id && isActive(r)));
      await Promise.all(stale.map(async id => { slot.jobs.set(id, await api.listJobs(slot.owner, slot.repo, id, slot.token)); }));
    } catch (err) {
      this.fail(slot, err);
    }
    this.publish();
  }

  async loadMore(slot: RepoSlot): Promise<void> {
    if (!slot.token) return;
    try {
      const next = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), slot.runsPage + 1, slot.token);
      slot.runsPage++;
      slot.runs = mergeRuns(slot.runs, next.runs);
      slot.runsTotal = next.total;
    } catch (err) {
      this.fail(slot, err);
    }
    this.publish();
  }

  /** The branch can change without a refetch: only the ● marker moves. */
  async refreshBranches(): Promise<void> {
    let changed = false;
    for (const s of this.all) {
      const branch = await makeRunGit(s.folder.fsPath)(['symbolic-ref', '--short', '-q', 'HEAD']).then(o => o.trim() || null, () => null);
      if (branch !== s.branch) { s.branch = branch; changed = true; }
    }
    if (changed) this.emitter.fire(undefined);
  }

  hasActiveRuns(): boolean { return this.all.some(s => s.token !== null && s.runs.some(isActive)); }

  /**
   * One polling tick: re-fetch the repos that have a run in play (and are not rate-limited), then say when to come back.
   * null = nothing is active, stop the timer.
   */
  async poll(): Promise<number | null> {
    const now = Date.now();
    const live = this.all.filter(s => s.token !== null && s.runs.some(isActive));
    if (live.length === 0) return null;
    await Promise.all(live.filter(s => (s.retryAt ?? 0) <= now).map(s => this.reloadRuns(s)));
    const stillLive = this.all.filter(s => s.token !== null && s.runs.some(isActive));
    if (stillLive.length === 0) return null;
    const since = Math.min(...stillLive.flatMap(s => s.runs.filter(isActive).map(r => Date.parse(r.startedAt ?? r.updatedAt) || now)));
    const retryAt = stillLive.reduce<number | null>((m, s) => (s.retryAt !== null && (m === null || s.retryAt > m) ? s.retryAt : m), null);
    return pollDelay({
      oldestActiveSince: Number.isFinite(since) ? since : null, now: Date.now(),
      failures: Math.max(...stillLive.map(s => s.failures)), retryAt,
    });
  }

  /** Shows `run` under a "Pinned" position of its repo until the next refresh (used by Reveal from the PR tab). */
  pin(slot: RepoSlot, run: WorkflowRun): void {
    if (!slot.runs.some(r => r.id === run.id)) slot.pinned = run;
    this.emitter.fire(undefined);
  }

  snapshot(): { state: WorkflowsState; repos: Array<{ runs: number; workflows: number }> } {
    return { state: this.state, repos: this.all.map(s => ({ runs: s.runs.length, workflows: s.workflows.length })) };
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────

  getParent(node: WfNode): WfNode | undefined {
    const repo = node.repo;
    // With one repo the root node is omitted, so its groups are the roots.
    const top: WfNode | undefined = this.all.length > 1 ? { kind: 'repo', repo } : undefined;
    switch (node.kind) {
      case 'repo': return undefined;
      case 'group': case 'signin': case 'error': return top;
      case 'note': return node.id === 'no-workflows' ? group(repo, 'workflows') : group(repo, 'runs');
      case 'run': case 'more': return group(repo, 'runs');
      case 'workflow': return group(repo, 'workflows');
      case 'job': return { kind: 'run', repo, run: node.run };
      case 'step': return { kind: 'job', repo, run: node.run, job: node.job };
    }
  }

  getTreeItem(node: WfNode): vscode.TreeItem {
    const state = (c: 'none' | 'collapsed' | 'expanded'): vscode.TreeItemCollapsibleState =>
      c === 'none' ? vscode.TreeItemCollapsibleState.None
        : c === 'collapsed' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
    const slot = this.slot(node.repo.key);
    switch (node.kind) {
      case 'run': case 'job': case 'step': case 'workflow': {
        const view = describeNode(node, { now: Date.now(), branch: slot?.branch ?? null });
        const item = new vscode.TreeItem(view.label, state(view.collapsible));
        item.id = view.id;
        item.description = view.description;
        item.tooltip = view.tooltip;
        item.iconPath = new vscode.ThemeIcon(view.icon.icon, view.icon.color ? new vscode.ThemeColor(view.icon.color) : undefined);
        item.contextValue = view.context;
        if (node.kind === 'job' || node.kind === 'step') item.command = { command: 'null.workflows.openLog', title: 'Open Log', arguments: [node] };
        if (node.kind === 'workflow') item.command = { command: 'null.workflows.openWorkflowFile', title: 'Open Workflow File', arguments: [node] };
        return item;
      }
      case 'repo': {
        const item = new vscode.TreeItem(`${node.repo.owner}/${node.repo.repo}`, vscode.TreeItemCollapsibleState.Expanded);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('repo');
        item.contextValue = 'repo';
        return item;
      }
      case 'signin': {
        const item = new vscode.TreeItem('Sign in to GitHub for this folder');
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('account');
        item.command = { command: 'null.workflows.signIn', title: 'Sign In', arguments: [node] };
        return item;
      }
      case 'error': {
        const item = new vscode.TreeItem(node.text);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
        item.description = 'Try Again';
        item.command = { command: 'null.workflows.refresh', title: 'Try Again' };
        return item;
      }
      case 'note': {
        const item = new vscode.TreeItem(node.text);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('info');
        item.contextValue = 'note';
        if (node.command) item.command = { command: node.command, title: node.text, arguments: [node] };
        return item;
      }
      case 'group': {
        const runs = node.group === 'runs';
        const item = new vscode.TreeItem(runs ? 'Runs' : 'Workflows', runs ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon(runs ? 'history' : 'file-code');
        if (!runs && slot && slot.workflowsTotal > slot.workflows.length) item.description = `first ${slot.workflows.length}`;
        return item;
      }
      case 'more': {
        const item = new vscode.TreeItem('Load more…');
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('ellipsis');
        item.command = { command: 'null.workflows.loadMore', title: 'Load More', arguments: [node] };
        return item;
      }
    }
  }

  async getChildren(node?: WfNode): Promise<WfNode[]> {
    if (!node) {
      if (this.state !== 'ready') return [];
      if (this.all.length === 1) return this.repoChildren(this.all[0]);
      return this.all.map(s => ({ kind: 'repo', repo: ref(s) }));
    }
    const slot = this.slot(node.repo.key);
    if (!slot) return [];
    switch (node.kind) {
      case 'repo': return this.repoChildren(slot);
      case 'group': return node.group === 'runs' ? this.runNodes(slot) : this.workflowNodes(slot);
      case 'run': return this.jobNodes(slot, node);
      case 'job': return node.job.steps.map(step => ({ kind: 'step', repo: node.repo, run: node.run, job: node.job, step }));
      default: return [];
    }
  }

  private repoChildren(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    if (!slot.token) return [{ kind: 'signin', repo }];
    if (slot.error && slot.runs.length === 0 && slot.workflows.length === 0) return [{ kind: 'error', repo, text: slot.error }];
    const rows: WfNode[] = [group(repo, 'runs'), group(repo, 'workflows')];
    return slot.failures >= 3 && slot.error ? [{ kind: 'error', repo, text: slot.error }, ...rows] : rows;
  }

  private runNodes(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    const rows: WfNode[] = [];
    if (slot.pinned) rows.push({ kind: 'run', repo, run: slot.pinned });
    rows.push(...slot.runs.map((run): WfNode => ({ kind: 'run', repo, run })));
    if (slot.runs.length === 0 && !slot.pinned) rows.push({ kind: 'note', repo, id: 'no-runs', text: isDefaultFilter(this.filter) ? 'No runs yet' : 'No runs match the filter' });
    if (slot.runs.length < slot.runsTotal) rows.push({ kind: 'more', repo });
    return rows;
  }

  private workflowNodes(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    if (slot.workflows.length === 0) return [{ kind: 'note', repo, id: 'no-workflows', text: 'No workflows yet', command: 'null.workflows.createWorkflow' }];
    return slot.workflows.map((workflow): WfNode => ({ kind: 'workflow', repo, workflow, dispatchable: slot.dispatchable.get(workflow.id) === true }));
  }

  private async jobNodes(slot: RepoSlot, node: Extract<WfNode, { kind: 'run' }>): Promise<WfNode[]> {
    let jobs = slot.jobs.get(node.run.id);
    if (!jobs) {
      try {
        jobs = await api.listJobs(slot.owner, slot.repo, node.run.id, slot.token);
        slot.jobs.set(node.run.id, jobs);
      } catch (err) {
        this.fail(slot, err);
        return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: `Could not load jobs: ${describeFailure(err)}` }];
      }
    }
    if (jobs.length === 0) return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: 'Waiting for jobs…' }];
    return jobs.map((job): WfNode => ({ kind: 'job', repo: node.repo, run: node.run, job }));
  }
}
