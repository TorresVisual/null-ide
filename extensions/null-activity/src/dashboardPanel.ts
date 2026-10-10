/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildDashboardModel, isDashboardRange, parseWebviewMessage, rangeFor } from './dashboardModel';
import { getDashboardHtml } from './dashboardHtml';
import { execGit } from './gitExec';
import { GitStatsService } from './gitStatsService';
import { resolveProject } from './projectIdentity';
import { DateRange } from './types';

const VIEW_TYPE = 'null-activity.dashboard';
const RANGE_KEY = 'null-activity.dashboard.range';
const THROTTLE_MS = 1_000;
const REFRESH_MS = 60_000;

/** Owns the single, reused dashboard tab. All data logic lives in dashboardModel.ts. */
export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private range: DashboardRange;
  private lastPush = 0;
  private pending: NodeJS.Timeout | undefined;
  private openDisposables: vscode.Disposable[] = [];
  private readonly gitStats: GitStatsService;
  /** `from:to` of the git load in progress, so the 1 s push throttle does not start a second one. */
  private loadingGit: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: ActivityService,
    private readonly log: (message: string) => void,
  ) {
    const saved = context.workspaceState.get<unknown>(RANGE_KEY);
    this.range = isDashboardRange(saved) ? saved : 'today';
    this.gitStats = new GitStatsService({
      folders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      trusted: () => vscode.workspace.isTrusted,
      resolveKey: (folder) => resolveProject(folder).key,
      exec: execGit,
      now: () => Date.now(),
      log: (message) => this.log(message),
    });
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Coding Activity', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [lib],
    });
    this.panel = panel;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getDashboardHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('dashboard.js'), asset('dashboard.css'));

    const refresh = setInterval(() => this.push(), REFRESH_MS);
    this.openDisposables.push(
      { dispose: () => clearInterval(refresh) },
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
      this.service.onDidChange(() => this.schedulePush()),
      // Enabling tracking from the banner (or in settings) changes `enabled`, which the service does not announce.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-activity')) this.schedulePush();
      }),
    );
    // With retainContextWhenHidden off the page reloads when the tab is shown again and sends `ready`,
    // so no push on visibility change is needed.
    panel.onDidDispose(() => this.closed(), undefined, this.openDisposables);
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed();
  }

  private closed(): void {
    this.panel = undefined;
    if (this.pending) clearTimeout(this.pending);
    this.pending = undefined;
    for (const d of this.openDisposables.splice(0)) d.dispose();
  }

  private onMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
    if (!message) return;
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
  private schedulePush(): void {
    if (this.pending) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - this.lastPush));
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.push();
    }, wait);
  }

  /** Builds and posts a snapshot; does nothing while the tab is hidden or closed. A failure keeps the previous model on screen. */
  private push(): void {
    const panel = this.panel;
    if (!panel || !panel.visible) return;
    this.lastPush = Date.now();
    try {
      const now = Date.now();
      const dateRange = rangeFor(this.range, now);
      // Stale numbers are better than none: they stay on screen while a reload runs.
      const { fresh, git } = this.gitStats.peek(dateRange);
      const message: HostToWebview = {
        type: 'model',
        model: buildDashboardModel(this.service, this.range, now, this.service.enabled, git),
      };
      void panel.webview.postMessage(message);
      if (!fresh) void this.refreshGit(dateRange);
    } catch (err) {
      this.log(`dashboard: could not build the model (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /**
   * Loads git data for `range`, then pushes again for whatever range is selected by then: the load only
   * warms the cache, so a range change mid-load can never show another range's numbers. `load` never
   * rejects and stores failures too, so this cannot loop.
   */
  private async refreshGit(range: DateRange): Promise<void> {
    const id = `${range.from}:${range.to}`;
    if (this.loadingGit === id) return;
    this.loadingGit = id;
    try {
      await this.gitStats.load(range);
    } finally {
      if (this.loadingGit === id) this.loadingGit = undefined;
    }
    if (this.panel) this.push();
  }
}
