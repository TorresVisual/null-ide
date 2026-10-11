'use strict';

import * as fs from 'fs';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { convertExport, formatSummary } from './wakatimeImport';
import { diskProjectResolver } from './wakatimeProjects';

async function pickExport(service: ActivityService): Promise<vscode.Uri | undefined> {
  const [uri] =
    (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'WakaTime export': ['json'] },
      openLabel: 'Import',
      title: 'Choose your WakaTime export (.json)',
    })) ?? [];
  if (!uri) return undefined;
  if (service.hasImport()) {
    const answer = await vscode.window.showWarningMessage(
      'Replace the previous WakaTime import?',
      { modal: true, detail: 'Time tracked natively is not affected.' },
      'Replace',
    );
    if (answer !== 'Replace') return undefined;
  }
  return uri;
}

export function registerImport(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-activity.importWakaTime', async (file?: vscode.Uri) => {
      // A caller that passes the file (a spec, another command) has already decided: no dialogs.
      const source = file ?? (await pickExport(service));
      if (!source) return;
      try {
        const summary = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Importing WakaTime history…' },
          async () => {
            const text = await fs.promises.readFile(source.fsPath, 'utf8');
            // ponytail: sync parse + convert block the extension host for a few seconds on a ~70 MB export; stream if that hurts.
            const { intervals, summary } = convertExport(JSON.parse(text), diskProjectResolver);
            service.replaceImported(intervals); // only after conversion succeeded
            return summary;
          },
        );
        void vscode.window.showInformationMessage(`Null Activity: ${formatSummary(summary)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`WakaTime import failed: ${message}`);
        void vscode.window.showErrorMessage(`Null Activity: WakaTime import failed. ${message}`);
      }
    }),
  );
}
