'use strict';

import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { RangeChoice, choiceRange, customRange, parseDay, trackedDataReport } from './privacy';

const SCHEME = 'null-activity';

interface RangePick extends vscode.QuickPickItem {
  id: RangeChoice | 'custom';
}

export function registerCommands(context: vscode.ExtensionContext, service: ActivityService, storageDir: string): void {
  const report = () => trackedDataReport({ storageDir, enabled: service.enabled, months: service.getMonthlyTotals() });

  context.subscriptions.push(
    // A content provider is read-only by construction; a fresh query per call forces a fresh read.
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: report }),

    vscode.commands.registerCommand('null-activity.showTrackedData', async () => {
      const uri = vscode.Uri.from({ scheme: SCHEME, path: '/Tracked data.txt', query: String(Date.now()) });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),

    vscode.commands.registerCommand('null-activity.deleteRange', async () => {
      const picks: RangePick[] = [
        { label: 'Today', id: 'today' },
        { label: 'Last 7 days', id: 'last7' },
        { label: 'This month', id: 'month' },
        { label: 'Custom…', id: 'custom' },
      ];
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Delete tracked activity for…' });
      if (!pick) return;

      let range;
      let label = pick.label.toLowerCase();
      if (pick.id === 'custom') {
        const validateInput = (v: string) => (parseDay(v) === undefined ? 'Use YYYY-MM-DD' : undefined);
        const from = await vscode.window.showInputBox({ prompt: 'First day to delete (YYYY-MM-DD)', validateInput });
        if (!from) return;
        const to = await vscode.window.showInputBox({ prompt: 'Last day to delete, inclusive (YYYY-MM-DD)', value: from, validateInput });
        if (!to) return;
        range = customRange(from, to);
        if (!range) {
          void vscode.window.showErrorMessage('Null Activity: the last day is before the first day.');
          return;
        }
        label = `${from} to ${to}`;
      } else {
        range = choiceRange(pick.id, Date.now());
      }

      const answer = await vscode.window.showWarningMessage(
        `Delete tracked activity for ${label}? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (answer !== 'Delete') return;
      try {
        service.deleteRange(range);
        void vscode.window.showInformationMessage(`Null Activity: deleted tracked activity for ${label}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),

    vscode.commands.registerCommand('null-activity.deleteAll', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Delete ALL tracked activity? This cannot be undone.',
        { modal: true },
        'Delete All',
      );
      if (answer !== 'Delete All') return;
      try {
        service.deleteAll();
        void vscode.window.showInformationMessage('Null Activity: all tracked activity deleted.');
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),
  );
}
