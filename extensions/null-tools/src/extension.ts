'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { registerRecentProjectsUriHandler } from './recentProjectsIntegration';
import { registerScratchAndNotesFeature } from './scratchNotesIntegration';
import { registerAutoGitignoreFeature } from './autoGitignore';
import { registerPortsFeature } from './portsIntegration';
import { registerWorktreesFeature } from './worktreesIntegration';
import { registerDiscordPresenceFeature } from './discordPresenceIntegration';
import { registerIssuesPanelFeature } from './issuesPanelIntegration';
import { getStagedDiff, getChangedFiles, heuristicMessage, runClaude } from './commitMessage';
import { registerUpdaterFeature } from './updaterIntegration';
import { registerCommitValidationFeature } from './commitValidationIntegration';
import { registerOpenInNullNotesFeature } from './nullNotes';
import { showWelcomePage } from './welcomePage';
import { registerDashboardFeature } from './dashboardIntegration';
import { registerClaudeTabFeature } from './claudeTabIntegration';
import { registerFollowAlongFeature } from './followAlongIntegration';
import { registerWhyIsThisHereFeature } from './whyIsThisHereIntegration';
import { registerRecoveryFeature } from './recovery/recoveryIntegration';

// ── Activation ─────────────────────────────────────────────────────────────

async function disableRestrictedMode(): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('security.workspace.trust');
    if (config.get('enabled') !== false) {
      await config.update('enabled', false, vscode.ConfigurationTarget.Global);
    }
    if (config.get('startupPrompt') !== 'never') {
      await config.update('startupPrompt', 'never', vscode.ConfigurationTarget.Global);
    }
    if (config.get('untrustedFiles') !== 'open') {
      await config.update('untrustedFiles', 'open', vscode.ConfigurationTarget.Global);
    }
    if (config.get('emptyWindow') !== false) {
      await config.update('emptyWindow', false, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Ignore error
  }
}

async function ensureWindowTitleFormat(): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('window');
    const expected = '${dirty}${rootName} - ${activeEditorShort}';
    if (config.get<string>('title') !== expected) {
      await config.update('title', expected, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Ignore error
  }
}

export function activate(context: vscode.ExtensionContext): void {
  disableRestrictedMode();
  ensureWindowTitleFormat();

  const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
  bar.text = '$(sparkle)'; bar.tooltip = 'Null: generate commit message';
  bar.command = 'null.generateCommitMessage'; bar.show();
  context.subscriptions.push(bar);

  registerDashboardFeature(context);
  registerRecentProjectsUriHandler(context);
  registerScratchAndNotesFeature(context);
  registerAutoGitignoreFeature(context);

  registerUpdaterFeature(context);
  registerCommitValidationFeature(context);

  context.subscriptions.push(vscode.commands.registerCommand('null.generateCommitMessage', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { vscode.window.showErrorMessage('Open a folder first.'); return; }
    const cwd  = folders[0].uri.fsPath;
    const diff = getStagedDiff(cwd);
    if (!diff.trim()) { vscode.window.showWarningMessage('No changes found (nothing staged or committed).'); return; }
    let message: string | undefined;
    if (!vscode.workspace.getConfiguration('null').get<boolean>('commitMessage.useClaude', true)) {
      message = heuristicMessage(getChangedFiles(cwd));
    } else try {
      await vscode.window.withProgress(
        { location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' },
        async () => { message = await runClaude(diff, cwd); },
      );
    } catch (err) {
      message = heuristicMessage(getChangedFiles(cwd));
      vscode.window.showWarningMessage(
        `Null: claude failed (${(err as Error).message.split('\n')[0]}). Inserted a basic message from the changed files — edit it before committing.`,
      );
    }
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) { vscode.window.showErrorMessage('Built-in git extension not found.'); return; }
    const git  = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    const repo = git.repositories.find((r: { rootUri: vscode.Uri }) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
    if (repo && message) { repo.inputBox.value = message; vscode.commands.executeCommand('workbench.view.scm'); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.clearWebviewCache', async () => {
    const appData = process.env.APPDATA;
    if (!appData) { vscode.window.showErrorMessage('Null: cannot locate %APPDATA%.'); return; }
    const userDataDir = path.join(appData, 'Null');
    const targets = ['Cache', 'CachedData', 'Code Cache', 'WebStorage'];
    const cleared: string[] = [], failed: string[] = [];
    for (const name of targets) {
      const p = path.join(userDataDir, name);
      try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); cleared.push(name); }
      catch { failed.push(name); }
    }
    const detail  = cleared.length ? `Cleared: ${cleared.join(', ')}.` : 'Nothing to clear.';
    const warning = failed.length  ? ` Could not delete: ${failed.join(', ')}.` : '';
    const choice  = await vscode.window.showInformationMessage(
      `${detail}${warning} Reload window to apply.`, 'Reload Now',
    );
    if (choice === 'Reload Now') vscode.commands.executeCommand('workbench.action.reloadWindow');
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('null.showWelcome', () => showWelcomePage(context)),
  );

  if (!context.globalState.get('null.welcomeShown')) {
    context.globalState.update('null.welcomeShown', true);
    showWelcomePage(context);
  }

  const plansDir = path.join(os.homedir(), '.claude', 'plans');
  const plansWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(plansDir), '*.md'),
    false, true, true,
  );
  plansWatcher.onDidCreate((uri) => {
    setTimeout(() => {
      if (vscode.workspace.getConfiguration('null').get<boolean>('plans.autoOpen', true)) {
        vscode.window.showTextDocument(uri);
      }
    }, 500);
  });
  context.subscriptions.push(plansWatcher);

  registerPortsFeature(context);
  registerWorktreesFeature(context);
  registerIssuesPanelFeature(context);
  registerDiscordPresenceFeature(context);
  registerOpenInNullNotesFeature(context);
  registerClaudeTabFeature(context);
  registerFollowAlongFeature(context);
  registerWhyIsThisHereFeature(context);
  registerRecoveryFeature(context);
}

export function deactivate(): void {}
