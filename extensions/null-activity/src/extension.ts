'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService, ActivitySettings, normalizeSettings } from './activityService';
import { registerCommands } from './commands';
import { DashboardPanel } from './dashboardPanel';
import { startHeartbeatSource } from './heartbeatSource';
import { IntervalStore } from './intervalStore';
import { resolveProject } from './projectIdentity';
import { StatusBar } from './statusBar';
import { NullActivityApi } from './types';

function readSettings(): ActivitySettings {
  const cfg = vscode.workspace.getConfiguration('null-activity');
  return normalizeSettings({ enabled: cfg.get('enabled'), idleTimeout: cfg.get('idleTimeout'), sessionGap: cfg.get('sessionGap') });
}

export function activate(context: vscode.ExtensionContext): NullActivityApi {
  const output = vscode.window.createOutputChannel('Null Activity');
  const storageDir = context.globalStorageUri.fsPath;
  const windowId = crypto.createHash('sha1').update(vscode.env.sessionId).digest('hex').slice(0, 10);

  const store = new IntervalStore({ dir: storageDir, windowId, log: (message) => output.appendLine(message) });
  const service = new ActivityService({ store, resolveProject, settings: readSettings });
  service.setFocused(vscode.window.state.focused);
  const statusBar = new StatusBar(service);
  const dashboard = new DashboardPanel(context, service, (message) => output.appendLine(message));

  const timers = [setInterval(() => service.tick(), 15_000), setInterval(() => service.flush(), 30_000)];

  context.subscriptions.push(
    output,
    service,
    statusBar,
    dashboard,
    startHeartbeatSource(service),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('null-activity')) {
        service.refresh();
        statusBar.update();
      }
    }),
    { dispose: () => timers.forEach(clearInterval) },
  );
  registerCommands(context, service, storageDir, dashboard);

  // Expose the read/session API only; deletion stays behind the user-confirmed commands.
  return {
    startSession: () => service.startSession(),
    pauseSession: () => service.pauseSession(),
    endSession: () => service.endSession(),
    recordActivity: (h) => service.recordActivity(h),
    getProjectStats: (r) => service.getProjectStats(r),
    getLanguageStats: (r) => service.getLanguageStats(r),
    getDailyStats: (r) => service.getDailyStats(r),
    getSessions: (r) => service.getSessions(r),
    getIntervals: (r) => service.getIntervals(r),
    onDidChange: service.onDidChange,
  };
}

export function deactivate(): void {}
