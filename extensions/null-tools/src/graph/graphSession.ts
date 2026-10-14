/// <reference path="./protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import { Result } from '../worktrees';
import { GitGraphService, resolveRepoRoot } from './gitGraphService';
import { BusyFlag, RunGit, makeRunGit } from './gitRun';
import { findRepository, getGitApi } from './gitApi';
import { classifyWorkspace, unavailableText } from './graphMessages';

export type Availability =
  | { ok: true; root: string; service: GitGraphService; read: RunGit; act: RunGit }
  | { ok: false; reason: GraphUnavailableReason };
export type ReadyAvailability = Extract<Availability, { ok: true }>;

const CHANGE_DEBOUNCE_MS = 500;
const ACTION_TIMEOUT_MS = 120_000;

/**
 * One per window. Resolves which repo the graph shows, shares one GitGraphService between the tab and the tree,
 * detects repository changes by fingerprint (the vscode.git event only triggers a check), and serializes actions.
 */
export class GraphSession implements vscode.Disposable {
  readonly busy = new BusyFlag();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private cached: Promise<Availability> | undefined;
  private consumers = 0;
  private watchers: vscode.Disposable[] = [];
  private lastFingerprint: string | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private readonly always: vscode.Disposable[];

  constructor() {
    this.always = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
    ];
  }

  availability(): Promise<Availability> {
    return (this.cached ??= this.resolve());
  }

  private async resolve(): Promise<Availability> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const reason = classifyWorkspace({ folderScheme: folder?.uri.scheme, trusted: vscode.workspace.isTrusted });
    if (reason) return this.publish({ ok: false, reason });
    const found = await resolveRepoRoot(folder!.uri.fsPath);
    if (!found.ok) return this.publish({ ok: false, reason: found.reason });
    const read = makeRunGit(found.root);
    return this.publish({ ok: true, root: found.root, service: new GitGraphService(read, found.root), read, act: makeRunGit(found.root, ACTION_TIMEOUT_MS) });
  }

  private publish(availability: Availability): Availability {
    void vscode.commands.executeCommand('setContext', 'null.graph.state', availability.ok ? 'ready' : availability.reason);
    return availability;
  }

  /** Forget the resolved repo (folders, trust or `git init` changed) and tell viewers to reload. */
  invalidate(): void {
    this.cached = undefined;
    this.lastFingerprint = undefined;
    this.stopWatching();
    if (this.consumers > 0) void this.startWatching();
    this.changed.fire();
  }

  /** A viewer (tab or visible tree) registers while it is showing; the change subscription runs only while one exists. */
  acquire(): vscode.Disposable {
    if (++this.consumers === 1) void this.startWatching();
    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        if (--this.consumers === 0) this.stopWatching();
      },
    };
  }

  private async startWatching(): Promise<void> {
    try {
      const availability = await this.availability();
      const api = await getGitApi();
      if (this.consumers === 0) return;
      const trigger = () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.checkNow(), CHANGE_DEBOUNCE_MS);
      };
      if (!availability.ok) {
        this.watchers.push(api.onDidOpenRepository(() => this.invalidate()));
        return;
      }
      const repo = findRepository(api, availability.root);
      this.watchers.push(repo ? repo.state.onDidChange(trigger) : api.onDidOpenRepository(trigger));
    } catch {
      // No git extension: viewers still work, they just refresh on focus and after actions.
    }
  }

  private stopWatching(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    for (const watcher of this.watchers.splice(0)) watcher.dispose();
  }

  private async fingerprint(): Promise<string | undefined> {
    const availability = await this.availability();
    if (!availability.ok) return undefined;
    const { hash, inProgress } = await availability.service.fingerprint();
    void vscode.commands.executeCommand('setContext', 'null.graph.operationInProgress', inProgress !== null);
    return hash;
  }

  /** Records the current fingerprint after a viewer loaded, without announcing a change. */
  async prime(): Promise<void> {
    try { this.lastFingerprint = await this.fingerprint(); } catch { /* transient git failure */ }
  }

  /** Announces a change when the fingerprint differs from the last one seen (or always with `force`). */
  async checkNow(force = false): Promise<void> {
    try {
      const hash = await this.fingerprint();
      if (hash === undefined) return;
      const changed = this.lastFingerprint !== undefined && hash !== this.lastFingerprint;
      this.lastFingerprint = hash;
      if (force || changed) this.changed.fire();
    } catch {
      // A transient failure keeps the last view; the next trigger retries.
    }
  }

  /** Runs one history-changing action: one at a time, refused during another operation unless allowed. */
  async runAction<T>(
    fn: (availability: ReadyAvailability) => Promise<Result<T>>,
    opts: { duringOperation?: boolean } = {},
  ): Promise<Result<T>> {
    const availability = await this.availability();
    if (!availability.ok) return { ok: false, message: unavailableText(availability.reason) };
    if (!opts.duringOperation) {
      const operation = await availability.service.inProgress();
      if (operation) return { ok: false, message: `A ${operation.kind} is in progress. Continue or abort it first.` };
    }
    const outcome = await this.busy.run(() => fn(availability));
    if (!outcome.ran) return { ok: false, message: 'Another Commit Graph action is still running.' };
    await this.checkNow(true);
    return outcome.value;
  }

  dispose(): void {
    this.stopWatching();
    for (const d of this.always) d.dispose();
    this.changed.dispose();
  }
}
