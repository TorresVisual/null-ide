'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { findProjectDir } from '../followAlong';
import { FoundMarker, findCrashed, isPidAlive, removeMarker, sharesFolder, writeMarker } from './crashMarker';
import { RecoverableSession, scanSessions } from './interruptedSessions';

const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CLAUDE_EXTENSION = 'anthropic.claude-code';
const OPEN_SESSION_COMMAND = 'claude-vscode.editor.open';

interface SessionItem extends vscode.QuickPickItem {
  session: RecoverableSession;
}

function collectSessions(found: FoundMarker[], windowFolders: string[], until: number): RecoverableSession[] {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const byId = new Map<string, RecoverableSession>();
  for (const { marker } of found) {
    for (const folder of marker.folders.filter(f => sharesFolder([f], windowFolders))) {
      const projectDir = findProjectDir(claudeProjectsDir, folder);
      if (!projectDir) continue;
      for (const s of scanSessions(projectDir, marker.startedAt, until)) byId.set(s.sessionId, s);
    }
  }
  return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

function toItem(session: RecoverableSession): SessionItem {
  return {
    label: session.title,
    description: new Date(session.lastActivity).toLocaleString(),
    detail: session.interrupted
      ? 'Interrupted mid-turn — the conversation is restored, the operation was not resumed'
      : 'Completed before the exit',
    iconPath: new vscode.ThemeIcon(session.interrupted ? 'warning' : 'comment-discussion'),
    session,
  };
}

async function review(found: FoundMarker[], windowFolders: string[], until: number): Promise<void> {
  const drop = (): void => found.forEach(f => removeMarker(f.file));
  // Nothing to offer without the Claude Code extension or any session from the crashed run.
  if (!vscode.extensions.getExtension(CLAUDE_EXTENSION)) return drop();
  const sessions = collectSessions(found, windowFolders, until);
  if (!sessions.length) return drop();

  const interrupted = sessions.filter(s => s.interrupted).length;
  const noun = sessions.length === 1 ? 'conversation was' : 'conversations were';
  const tail = interrupted ? ` (${interrupted} interrupted mid-turn)` : '';
  const choice = await vscode.window.showWarningMessage(
    `Null IDE closed unexpectedly. Unsaved editors were restored by VS Code. ${sessions.length} Claude ${noun} open${tail}.`,
    'Review',
    'Later',
    'Discard',
  );
  if (choice === 'Discard') return drop();
  if (choice !== 'Review') return; // Later, or the toast was dismissed: ask again next launch

  let remaining = sessions;
  while (remaining.length) {
    const pick = await vscode.window.showQuickPick(remaining.map(toItem), {
      placeHolder: 'Open a Claude conversation from before the exit',
    });
    if (!pick) return; // left early: keep the rest pending
    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND, pick.session.sessionId);
    remaining = remaining.filter(s => s !== pick.session);
  }
  drop();
}

export function registerRecoveryFeature(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.getConfiguration('null.recovery').get<boolean>('enabled', true)) return;
  try {
    const dir = path.join(context.globalStorageUri.fsPath, 'recovery');
    const startedAt = Date.now();
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

    // Scan before writing our own marker so we never see ourselves.
    const relevant: FoundMarker[] = [];
    for (const crashed of findCrashed(dir, isPidAlive, startedAt, MAX_AGE_MS)) {
      if (crashed.marker.folders.length === 0) removeMarker(crashed.file); // nothing to review
      else if (sharesFolder(crashed.marker.folders, folders)) relevant.push(crashed);
    }

    const file = writeMarker(dir, { pid: process.pid, startedAt, folders });
    context.subscriptions.push({ dispose: () => removeMarker(file) });

    if (relevant.length) {
      review(relevant, folders, startedAt).catch(err => console.error('[null-recovery]', err));
    }
  } catch (err) {
    console.error('[null-recovery]', err);
  }
}
