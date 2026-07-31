'use strict';

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { PortEntry, PortsTreeProvider } from './portsTreeView';

function getConfig(): { intervalSec: number; filterDevOnly: boolean } {
  const cfg = vscode.workspace.getConfiguration('null.ports');
  return {
    intervalSec:   cfg.get<number>('refreshInterval', 5),
    filterDevOnly: cfg.get<boolean>('filterDevOnly', true),
  };
}

function urlForPort(port: number): vscode.Uri {
  return vscode.Uri.parse(`http://localhost:${port}`);
}

function killPid(pid: number): void {
  // On Windows, /F forces termination of the entire process tree
  execSync(`taskkill /PID ${pid} /F`, { windowsHide: true, timeout: 5000 });
}

export function registerPortsFeature(context: vscode.ExtensionContext): void {
  const provider = new PortsTreeProvider();

  // Apply initial config
  const { intervalSec, filterDevOnly } = getConfig();
  provider.setFilterDevOnly(filterDevOnly);
  provider.startAutoRefresh(intervalSec);

  // Re-apply config when user changes settings
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null.ports')) {
        const cfg = getConfig();
        provider.setFilterDevOnly(cfg.filterDevOnly);
        provider.startAutoRefresh(cfg.intervalSec);
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('null.portsView', provider),
  );

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('null.ports.refresh', () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.ports.openInBrowser', async (entry?: PortEntry) => {
      if (!entry) {
        // Fallback: ask the user to pick from the current list
        const items = provider.entries.map(e => ({
          label:       `$(rocket)  :${e.port}`,
          description: e.processName + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
          entry:       e,
        }));
        if (items.length === 0) {
          vscode.window.showInformationMessage('No active dev servers detected.');
          return;
        }
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Open in browser…' });
        if (!picked) { return; }
        entry = picked.entry;
      }
      await vscode.env.openExternal(urlForPort(entry.port));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.ports.killProcess', async (entry?: PortEntry) => {
      if (!entry) {
        const items = provider.entries.map(e => ({
          label:       `$(trash)  :${e.port}`,
          description: `${e.processName} (PID ${e.pid})` + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
          entry:       e,
        }));
        if (items.length === 0) {
          vscode.window.showInformationMessage('No active dev servers detected.');
          return;
        }
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Kill process…' });
        if (!picked) { return; }
        entry = picked.entry;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Kill **${entry.processName}** (PID ${entry.pid}) on port ${entry.port}?`,
        { modal: true },
        'Kill',
      );
      if (confirm !== 'Kill') { return; }

      try {
        killPid(entry.pid);
        vscode.window.showInformationMessage(
          `Killed ${entry.processName} (PID ${entry.pid}) — port :${entry.port} freed.`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to kill PID ${entry.pid}: ${(err as Error).message}`,
        );
      }
      // Refresh after a short delay so OS releases the port
      setTimeout(() => provider.refresh(), 800);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.ports.copyUrl', async (entry?: PortEntry) => {
      if (!entry) {
        const items = provider.entries.map(e => ({
          label:       `$(copy)  :${e.port}`,
          description: e.processName + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
          entry:       e,
        }));
        if (items.length === 0) {
          vscode.window.showInformationMessage('No active dev servers detected.');
          return;
        }
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Copy URL…' });
        if (!picked) { return; }
        entry = picked.entry;
      }
      const url = `http://localhost:${entry.port}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.setStatusBarMessage(`$(copy) Copied ${url}`, 2500);
    }),
  );

  // Dispose the auto-refresh timer on deactivation
  context.subscriptions.push({ dispose: () => provider.stopAutoRefresh() });
}
