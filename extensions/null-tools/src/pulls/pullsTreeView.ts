'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { getWorkspaceGithubRepo } from '../github/githubRemote';
import { classifyWorkspace } from '../graph/graphMessages';
import { makeRunGit } from '../graph/gitRun';
import { fetchMergeBase, fetchPullFiles, fetchReviewThreads, listOpenPulls } from './pullApi';
import { PullDetail, PullFile, PullSummary, describeFailure, pinCurrent, pullBranch, threadCount } from './pullModel';
import { PullReview } from './pullReview';

export type PullNode = { kind: 'pull'; pull: PullSummary } | { kind: 'file'; detail: PullDetail; file: PullFile };

/** What the view shows; every value except `ready` has a welcome message in package.json (`null.pulls.state`). */
export type PullsState =
  | 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git' | 'no-repo' | 'signed-out' | 'error' | 'empty' | 'ready';

const CHECK_COLORS = { success: 'charts.green', failure: 'charts.red', pending: 'charts.yellow', none: undefined } as const;
const STATUS_LETTER = { added: 'A', removed: 'D', renamed: 'R', modified: 'M' } as const;

export class PullsTreeProvider implements vscode.TreeDataProvider<PullNode> {
  private readonly emitter = new vscode.EventEmitter<PullNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private pulls: PullSummary[] = [];
  private readonly details = new Map<number, Promise<PullDetail>>();
  /** Outdated-thread counts of PRs whose detail has loaded; shown in the PR's tooltip. */
  private readonly outdated = new Map<number, number>();
  private repo: { owner: string; repo: string } | null = null;
  private token: string | null = null;
  private current: string | null = null;

  loaded = false;
  state: PullsState = 'no-folder';
  /** The tree's one-line detail for the `error` state; undefined otherwise. */
  onMessage: (message: string | undefined) => void = () => undefined;

  constructor(private readonly review: PullReview) {}

  async refresh(): Promise<void> {
    this.loaded = true;
    this.details.clear();
    this.outdated.clear();
    this.review.clear();
    this.pulls = [];
    let message: string | undefined;
    this.state = await this.resolveState();
    if (this.state === 'ready') {
      try {
        this.pulls = pinCurrent(await listOpenPulls(this.repo!.owner, this.repo!.repo, this.token), this.current);
        this.state = this.pulls.length === 0 ? 'empty' : 'ready';
      } catch (err) {
        this.state = 'error';
        message = describeFailure(err);
      }
    }
    void vscode.commands.executeCommand('setContext', 'null.pulls.state', this.state);
    this.onMessage(message);
    this.emitter.fire(undefined);
  }

  /** Everything that decides whether the list can be fetched at all, in the order the commit graph checks it. */
  private async resolveState(): Promise<PullsState> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const blocked = classifyWorkspace({ folderScheme: folder?.uri.scheme, trusted: vscode.workspace.isTrusted });
    if (blocked) return blocked;
    const git = makeRunGit(folder!.uri.fsPath);
    if (!await git(['rev-parse', '--is-inside-work-tree']).then(() => true, () => false)) return 'not-a-repo';
    // null on a detached HEAD: no PR is marked current
    this.current = await git(['symbolic-ref', '--short', '-q', 'HEAD']).then(out => out.trim() || null, () => null);
    this.repo = getWorkspaceGithubRepo(folder!.uri.fsPath);
    if (!this.repo) return 'no-repo';
    const session = await getGithubSession(false);
    this.token = session?.accessToken ?? null;
    return session ? 'ready' : 'signed-out';
  }

  getTreeItem(node: PullNode): vscode.TreeItem {
    if (node.kind === 'file') {
      const { file, detail } = node;
      const item = new vscode.TreeItem(vscode.Uri.file(file.path), vscode.TreeItemCollapsibleState.None);
      const dir = path.posix.dirname(file.path);
      const threads = threadCount(detail.threads, file.path);
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
    const isCurrent = this.current !== null && pullBranch(pull) === this.current;
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

  async getChildren(node?: PullNode): Promise<PullNode[]> {
    if (!node) return this.pulls.map(pull => ({ kind: 'pull', pull }));
    if (node.kind === 'file') return [];
    try {
      const detail = await this.detail(node.pull);
      if (detail.outdated && !this.outdated.has(node.pull.number)) {
        this.outdated.set(node.pull.number, detail.outdated);
        this.emitter.fire(node); // same id, so it stays expanded; only the tooltip changes
      }
      return detail.files.map(file => ({ kind: 'file', detail, file }));
    } catch (err) {
      this.details.delete(node.pull.number);
      void vscode.window.showErrorMessage(`Could not load #${node.pull.number}: ${describeFailure(err)}`);
      return [];
    }
  }

  private detail(pull: PullSummary): Promise<PullDetail> {
    let cached = this.details.get(pull.number);
    if (!cached) {
      cached = this.load(pull);
      this.details.set(pull.number, cached);
    }
    return cached;
  }

  private async load(pull: PullSummary): Promise<PullDetail> {
    const repo = this.repo;
    if (!repo) throw new Error('This folder has no GitHub remote.'); // unreachable in `ready`; keeps the types honest
    const [files, mergeBase, threads] = await Promise.all([ // threads: { threads, outdated }
      fetchPullFiles(repo.owner, repo.repo, pull.number, this.token),
      fetchMergeBase(repo.owner, repo.repo, pull.baseSha, pull.headSha, this.token),
      fetchReviewThreads(repo.owner, repo.repo, pull.number, this.token),
    ]);
    const detail: PullDetail = { repo, pull, mergeBase, files, threads: threads.threads, outdated: threads.outdated };
    this.review.show(detail, threads.threads);
    return detail;
  }
}
