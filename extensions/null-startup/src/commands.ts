'use strict';

import * as vscode from 'vscode';
import { reportToJson, reportToMarkdown } from './exportReport';
import { stamp } from './format';
import { ReportPanel } from './reportPanel';
import { ReportStore } from './reportStore';

export function registerCommands(context: vscode.ExtensionContext, store: ReportStore, panel: ReportPanel, slowMs: () => number): void {
  const none = () => vscode.window.showInformationMessage('No startup report has been recorded yet.');
  context.subscriptions.push(
    vscode.commands.registerCommand('null-startup.openReport', () => panel.reveal()),

    vscode.commands.registerCommand('null-startup.copyReport', async () => {
      const report = await panel.selectedReport();
      if (!report) return void none();
      await vscode.env.clipboard.writeText(reportToMarkdown(report, slowMs()));
      void vscode.window.showInformationMessage('Startup report copied to the clipboard.');
    }),

    vscode.commands.registerCommand('null-startup.exportReport', async () => {
      const report = await panel.selectedReport();
      if (!report) return void none();
      const name = `null-startup-${stamp(report.takenAt).replace(/[: ]/g, '-')}.json`;
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), filters: { JSON: ['json'] } });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(reportToJson(report), 'utf8'));
    }),

    vscode.commands.registerCommand('null-startup.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage('Delete all stored startup reports?', { modal: true }, 'Delete');
      if (confirm !== 'Delete') return;
      await store.clear();
      panel.refresh();
    }),
  );
}
