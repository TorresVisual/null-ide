'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  SCRATCH_LANGUAGES,
  getScratchDir,
  getNotesDir,
  ensureDir,
  ensureGitignoreEntry,
  buildScratchFilename,
  buildNoteFilename,
  deriveNoteLabel,
} from './scratchNotesStorage';
import { FolderTreeProvider } from './scratchNotesTreeView';

const output = vscode.window.createOutputChannel('Null Scratch & Notes');

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function tryEnsureGitignoreEntry(root: string): void {
  try {
    ensureGitignoreEntry(root);
  } catch (err) {
    output.appendLine(`Could not update .gitignore: ${(err as Error).message}`);
  }
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function renameItem(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const newName = await vscode.window.showInputBox({ prompt: 'New file name', value: oldName });
  if (!newName || newName === oldName) { return; }
  fs.renameSync(filePath, path.join(dir, newName));
}

async function deleteItem(filePath: string): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete "${path.basename(filePath)}"?`,
    { modal: true },
    'Delete',
  );
  if (confirmed !== 'Delete') { return; }
  fs.unlinkSync(filePath);
}

export function registerScratchAndNotesFeature(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot();

  const scratchProvider = new FolderTreeProvider(
    workspaceRoot ? getScratchDir(workspaceRoot) : undefined,
    filePath => path.basename(filePath),
  );
  const notesProvider = new FolderTreeProvider(
    workspaceRoot ? getNotesDir(workspaceRoot) : undefined,
    filePath => deriveNoteLabel(filePath, readFileSafe(filePath)),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('null.scratchView', scratchProvider),
    vscode.window.registerTreeDataProvider('null.notesView', notesProvider),
    scratchProvider.watch(),
    notesProvider.watch(),
  );

  context.subscriptions.push(vscode.commands.registerCommand('null.newScratchFile', async () => {
    const root = getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage('Open a folder to create scratch files.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      SCRATCH_LANGUAGES.map(lang => ({ label: lang.label, lang })),
      { placeHolder: 'Select a language for the new scratch file' },
    );
    if (!picked) { return; }

    const scratchDir = getScratchDir(root);
    let filePath: string;
    try {
      ensureDir(scratchDir);
      filePath = path.join(scratchDir, buildScratchFilename(picked.lang.extension));
      fs.writeFileSync(filePath, '');
    } catch (err) {
      vscode.window.showErrorMessage(`Could not create scratch file: ${(err as Error).message}`);
      return;
    }
    tryEnsureGitignoreEntry(root);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.newNote', async () => {
    const root = getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage('Open a folder to create notes.');
      return;
    }
    const title = await vscode.window.showInputBox({ prompt: 'Note title' });
    if (!title) { return; }

    const notesDir = getNotesDir(root);
    let filePath: string;
    try {
      ensureDir(notesDir);
      const existing = fs.readdirSync(notesDir);
      filePath = path.join(notesDir, buildNoteFilename(title, existing));
      fs.writeFileSync(filePath, `# ${title}\n\n`);
    } catch (err) {
      vscode.window.showErrorMessage(`Could not create note: ${(err as Error).message}`);
      return;
    }
    tryEnsureGitignoreEntry(root);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('null.renameScratchOrNoteItem', renameItem),
    vscode.commands.registerCommand('null.deleteScratchOrNoteItem', deleteItem),
    output,
  );
}
