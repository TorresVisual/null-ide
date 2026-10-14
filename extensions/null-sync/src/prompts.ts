'use strict';

import * as vscode from 'vscode';
import { passphraseProblem } from './cryptoBox';
import { EnablePrompts } from './enable';
import { Revision } from './gistStore';
import { Category, FirstSync } from './types';

const secret = (options: vscode.InputBoxOptions): Thenable<string | undefined> =>
  vscode.window.showInputBox({ password: true, ignoreFocusOut: true, ...options });

/** What the user is agreeing to upload, in words (the setting name alone says little for `activity`). */
export const describeCategory = (category: Category): string =>
  category === 'activity' ? 'coding activity history (project names, file paths, languages and times)' : category;

export const enablePrompts: EnablePrompts = {
  async chooseAccount(accounts) {
    const picked = await vscode.window.showQuickPick(
      accounts.map((account) => ({ label: `@${account.username}`, account })),
      { placeHolder: 'Sync settings with which GitHub account?' },
    );
    return picked?.account;
  },

  async consent(categories) {
    const answer = await vscode.window.showWarningMessage(
      `Upload your ${categories.map(describeCategory).join(', ')} to a secret GitHub Gist? They are encrypted on this device with a passphrase you choose, so only someone who knows it can read them. The passphrase cannot be recovered or reset.`,
      { modal: true },
      'Enable Sync',
    );
    return answer === 'Enable Sync';
  },

  async newPassphrase() {
    const first = await secret({
      title: 'Null Sync: choose a passphrase',
      prompt: 'At least 12 characters. It cannot be recovered or reset, and you will enter it once on each device.',
      validateInput: (value) => passphraseProblem(value, value),
    });
    if (first === undefined) return undefined;
    const second = await secret({
      title: 'Null Sync: confirm the passphrase',
      prompt: 'Enter it again.',
      validateInput: (value) => passphraseProblem(first, value),
    });
    return second === undefined ? undefined : first;
  },

  existingPassphrase: (attempt) =>
    Promise.resolve(
      secret({
        title: 'Null Sync: enter your passphrase',
        prompt:
          attempt === 1
            ? 'This account already has synced settings. Enter the passphrase you chose on your first device.'
            : 'That was not the right passphrase. Try again.',
      }),
    ),

  async firstSync() {
    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: FirstSync | 'each' }>(
      [
        { label: 'Use the synced settings', description: 'Replace this device\'s files; your versions are backed up', value: 'cloud' },
        { label: 'Use this device\'s settings', description: 'Replace the synced files with this device\'s', value: 'device' },
        { label: 'Decide file by file', description: 'Keep both for now and resolve each difference yourself', value: 'each' },
      ],
      { placeHolder: 'This device already has settings. How should they be combined with the synced ones?', ignoreFocusOut: true },
    );
    return picked?.value;
  },
};

export async function chooseConflictAction(file: string): Promise<'mine' | 'theirs' | 'diff' | undefined> {
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: 'mine' | 'theirs' | 'diff' }>(
    [
      { label: 'Keep mine', description: 'Upload this device\'s version', value: 'mine' },
      { label: 'Take theirs', description: 'Use the synced version; yours is backed up', value: 'theirs' },
      { label: 'Show diff', description: 'Compare the two first', value: 'diff' },
    ],
    { placeHolder: `${file} changed on this device and on another one`, ignoreFocusOut: true },
  );
  return picked?.value;
}

export async function chooseRevision(revisions: Revision[]): Promise<Revision | undefined> {
  const picked = await vscode.window.showQuickPick(
    revisions.map((revision) => ({ label: new Date(revision.date).toLocaleString(), description: revision.sha.slice(0, 7), revision })),
    { placeHolder: 'Restore the synced settings as they were at…' },
  );
  return picked?.revision;
}

export async function confirmRestore(revision: Revision): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(
    `Restore the synced settings from ${new Date(revision.date).toLocaleString()}? This device and every synced device will switch to that version. The current files are backed up on this device first.`,
    { modal: true },
    'Restore',
  );
  return answer === 'Restore';
}

export async function confirmStop(): Promise<'stop' | 'delete' | undefined> {
  const answer = await vscode.window.showWarningMessage(
    'Stop syncing on this device? Your local files are not changed.',
    { modal: true },
    'Stop Syncing',
    'Stop and Delete the Synced Copy',
  );
  return answer === 'Stop Syncing' ? 'stop' : answer === 'Stop and Delete the Synced Copy' ? 'delete' : undefined;
}
