/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildDashboardModel, isDashboardRange, parseWebviewMessage } from './dashboardModel';
import { getDashboardHtml } from './dashboardHtml';

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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: ActivityService,
    private readonly log: (message: string) => void,
  ) {
    const saved = context.workspaceState.get<unknown>(RANGE_KEY);
    this.range = isDashboardRange(saved) ? saved : 'today';
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
      const message: HostToWebview = {
        type: 'model',
        model: buildDashboardModel(this.service, this.range, Date.now(), this.service.enabled),
      };
      void panel.webview.postMessage(message);
    } catch (err) {
      this.log(`dashboard: could not build the model (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
