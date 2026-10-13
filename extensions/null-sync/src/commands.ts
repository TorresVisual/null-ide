'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { CANCELLED, EnableDeps, enable } from './enable';
import * as prompts from './prompts';
import { describeStatus } from './statusText';
import { SyncEngine } from './syncEngine';
import { CATEGORIES } from './types';

const config = () => vscode.workspace.getConfiguration('null-sync');

function report(engine: SyncEngine, done: string): void {
  const s = engine.getStatus();
  if (s.state === 'idle') void vscode.window.showInformationMessage(`Null Sync: ${done}`);
  else if (s.message) void vscode.window.showWarningMessage(`Null Sync: ${s.message}`);
  else if (s.state === 'needsAttention') {
    void vscode.window.showInformationMessage('Null Sync: some items need attention. Run "Null: Show Sync Status".');
  }
}

async function showDiff(engine: SyncEngine, userDir: string, file: string): Promise<void> {
  const remote = await engine.previewRemote(file);
  const synced = await vscode.workspace.openTextDocument({ content: remote ?? '', language: 'jsonc' });
  const local = vscode.Uri.file(path.join(userDir, ...file.split('/')));
  const note = file === 'settings.json' ? ' (excluded settings are not synced)' : '';
  await vscode.commands.executeCommand('vscode.diff', synced.uri, local, `${file}: synced ↔ this device${note}`);
}

/** Asks what to do with one conflict until the user decides; false if they gave up. */
async function resolveOne(engine: SyncEngine, userDir: string, file: string): Promise<boolean> {
  for (;;) {
    const choice = await prompts.chooseConflictAction(file);
    if (choice === undefined) return false;
    if (choice === 'diff') {
      await showDiff(engine, userDir, file);
      continue;
    }
    await engine.resolve(file, choice);
    return true;
  }
}

export function registerCommands(context: vscode.ExtensionContext, engine: SyncEngine, enableDeps: EnableDeps, userDir: string): void {
  const resolveAll = async (): Promise<void> => {
    for (const { file } of [...engine.getStatus().conflicts]) {
      if (!(await resolveOne(engine, userDir, file))) return;
    }
    report(engine, 'all conflicts resolved.');
  };

  const restore = async (): Promise<void> => {
    const revisions = await engine.revisions();
    if (!revisions) return report(engine, '');
    const picked = await prompts.chooseRevision(revisions);
    if (!picked || !(await prompts.confirmRestore(picked))) return;
    await engine.restore(picked.sha);
    report(engine, 'restored.');
  };

  const stop = async (): Promise<void> => {
    const choice = await prompts.confirmStop();
    if (!choice) return;
    const result = await engine.stop(choice === 'delete');
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
      return;
    }
    await config().update('enabled', false, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('Null Sync: stopped on this device. Your local files were not changed.');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('null.sync.enable', async () => {
      const result = await enable(enableDeps, prompts.enablePrompts);
      if (!result.ok) {
        if (result.message !== CANCELLED) void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
        return;
      }
      await config().update('enabled', true, vscode.ConfigurationTarget.Global);
      await engine.run({ interactive: true, firstSync: result.firstSync });
      report(engine, 'sync is on.');
    }),

    vscode.commands.registerCommand('null.sync.syncNow', async () => {
      await engine.run({ interactive: true });
      report(engine, 'up to date.');
    }),

    vscode.commands.registerCommand('null.sync.resolveConflicts', resolveAll),
    vscode.commands.registerCommand('null.sync.restore', restore),
    vscode.commands.registerCommand('null.sync.stop', stop),

    vscode.commands.registerCommand('null.sync.setCategories', async () => {
      const current: Record<string, boolean> = {
        ...Object.fromEntries(CATEGORIES.map((category) => [category, true])),
        ...config().get<Record<string, boolean>>('categories'),
      };
      const picked = await vscode.window.showQuickPick(
        CATEGORIES.map((category) => ({ label: category, picked: current[category] !== false })),
        { canPickMany: true, placeHolder: 'Choose what to sync on this device' },
      );
      if (!picked) return;
      const next = Object.fromEntries(CATEGORIES.map((category) => [category, picked.some((p) => p.label === category)]));
      await config().update('categories', next, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('null.sync.showStatus', async () => {
      const s = engine.getStatus();
      type Item = vscode.QuickPickItem & { run?: () => Thenable<unknown> };
      const items: Item[] = [{ label: `$(sync) ${describeStatus(s, Date.now())}`, description: s.message }];
      for (const c of s.conflicts) {
        items.push({ label: `$(warning) Resolve conflict: ${c.file}`, run: () => resolveOne(engine, userDir, c.file) });
      }
      for (const file of s.pending) {
        items.push({ label: `$(clock) Waiting for unsaved changes: ${file}`, description: 'applied once it is saved or closed' });
      }
      items.push(
        { label: '$(sync) Sync now', run: () => vscode.commands.executeCommand('null.sync.syncNow') },
        { label: '$(history) Restore an earlier version…', run: restore },
        { label: '$(debug-stop) Stop syncing…', run: stop },
      );
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Null Sync' });
      await picked?.run?.();
    }),
  );
}
