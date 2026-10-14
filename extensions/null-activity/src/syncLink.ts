'use strict';

import * as vscode from 'vscode';
import { ActivitySync, ActivitySyncDeps, SyncPort } from './activitySync';

const STARTUP_MS = 10_000;
const INTERVAL_MS = 10 * 60_000;

/** null-sync is optional: without it (or with the activity category off) the port is missing or refuses and nothing leaves the device. */
async function syncPort(): Promise<SyncPort | undefined> {
  const ext = vscode.extensions.getExtension<Partial<SyncPort>>('null.null-sync');
  if (!ext) return undefined;
  const api = ext.isActive ? ext.exports : await ext.activate();
  return typeof api?.syncActivity === 'function' ? (api as SyncPort) : undefined;
}

/** Runs the activity sync shortly after startup and every 10 minutes, silently. */
export function startActivitySync(deps: Omit<ActivitySyncDeps, 'port'>): vscode.Disposable {
  const sync = new ActivitySync({ ...deps, port: syncPort });
  const run = () => void sync.run();
  const startup = setTimeout(run, STARTUP_MS);
  const timer = setInterval(run, INTERVAL_MS);
  return { dispose: () => { clearTimeout(startup); clearInterval(timer); } };
}
