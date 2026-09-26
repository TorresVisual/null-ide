'use strict';

import * as vscode from 'vscode';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  CreateWorktreeOptions, WorktreeEntry,
  createWorktree, getBaseBranch, listLocalBranches, mergeWorktreeBack,
  pruneCandidates, pruneWorktrees, removeWorktree, resolveMainWorktreeRoot,
} from './worktrees';
import { WorktreeTreeProvider } from './worktreesTreeView';

function repoCwd(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return folder ? resolveMainWorktreeRoot(folder) : null;
}

function getCopyFilesGlob(): string[] {
  return vscode.workspace.getConfiguration('null.worktrees').get<string[]>('copyFilesGlob', []);
}

export async function copySetupFiles(sourceCwd: string, destCwd: string, globs: string[]): Promise<void> {
  for (const glob of globs) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(sourceCwd), glob));
    for (const match of matches) {
      const rel = path.relative(sourceCwd, match.fsPath);
      const dest = path.join(destCwd, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(match.fsPath, dest);
    }
  }
}

async function createAndOffer(cwd: string, opts: CreateWorktreeOptions, provider: WorktreeTreeProvider): Promise<void> {
  const result = createWorktree(cwd, opts);
  if (!result.ok) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${result.message}`);
    return;
  }
  const globs = getCopyFilesGlob();
  if (globs.length > 0) await copySetupFiles(cwd, result.value.path, globs);
  await provider.refresh();

  const choice = await vscode.window.showInformationMessage(
    `Worktree created on branch ${result.value.branch}.`, 'Open in New Window', 'Stay Here',
  );
  if (choice === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.value.path), { forceNewWindow: true });
  }
}

export function registerWorktreesFeature(context: vscode.ExtensionContext): void {
  const provider = new WorktreeTreeProvider(repoCwd);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('null.worktreesView', provider));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.refresh', () => provider.refresh()));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.new', async () => {
    const cwd = repoCwd();
    if (!cwd) { vscode.window.showErrorMessage('Open a folder first.'); return; }

    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(issues) From Issue…', pickKind: 'issue' as const },
        { label: '$(git-branch) From Existing Branch…', pickKind: 'branch' as const },
        { label: '$(edit) From Scratch…', pickKind: 'scratch' as const },
      ],
      { placeHolder: 'New worktree…' },
    );
    if (!picked) return;

    if (picked.pickKind === 'issue') {
      await vscode.commands.executeCommand('workbench.view.extension.null-issues');
      vscode.window.showInformationMessage('Pick an issue in the GitHub Issues panel, then use its "Create Worktree for Issue" button.');
      return;
    }

    let opts: CreateWorktreeOptions;
    if (picked.pickKind === 'branch') {
      const branches = listLocalBranches(cwd);
      const branchPick = await vscode.window.showQuickPick(branches, { placeHolder: 'Pick a branch…' });
      if (!branchPick) return;
      opts = { kind: 'branch', branch: branchPick };
    } else {
      const description = await vscode.window.showInputBox({ prompt: 'Describe the work (used to name the branch)' });
      if (!description) return;
      opts = { kind: 'scratch', description };
    }

    await createAndOffer(cwd, opts, provider);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.createForIssue', async (issueNumber: number, title: string) => {
    const cwd = repoCwd();
    if (!cwd) return;
    await createAndOffer(cwd, { kind: 'issue', issueNumber, title }, provider);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openInNewWindow', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: true });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.revealInExplorer', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openTerminal', (entry?: WorktreeEntry) => {
    if (!entry) return;
    const terminal = vscode.window.createTerminal({ name: entry.branch ?? entry.path, cwd: entry.path });
    terminal.show();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.remove', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    const cwd = repoCwd();
    if (!cwd) return;
    if (entry.isCurrent) { vscode.window.showErrorMessage('Cannot remove the worktree currently open in this window.'); return; }

    const confirm = await vscode.window.showWarningMessage(
      `Remove worktree at ${entry.path}${entry.dirty ? ' (has uncommitted changes)' : ''}?`,
      { modal: true }, 'Remove',
    );
    if (confirm !== 'Remove') return;

    const result = removeWorktree(cwd, entry.path, entry.dirty);
    if (!result.ok) vscode.window.showErrorMessage(`Failed to remove worktree: ${result.message}`);
    await provider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.mergeBack', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    if (!entry.branch) { vscode.window.showErrorMessage('Cannot merge a detached-HEAD worktree — it has no branch.'); return; }
    const cwd = repoCwd();
    if (!cwd) return;
    const baseBranch = getBaseBranch(cwd);
    if (entry.branch === baseBranch) { vscode.window.showInformationMessage(`${entry.branch} is already the base branch.`); return; }

    let result = mergeWorktreeBack(cwd, entry.branch, baseBranch, 'ff-only');
    if (!result.ok && result.reason === 'merge') {
      const retry = await vscode.window.showWarningMessage(
        `Fast-forward merge failed (${result.message}). Try a regular merge instead?`, 'Merge', 'Cancel',
      );
      if (retry !== 'Merge') return;
      result = mergeWorktreeBack(cwd, entry.branch, baseBranch, 'merge');
    }
    if (!result.ok) { vscode.window.showErrorMessage(`Merge failed: ${result.message}`); return; }

    await provider.refresh();
    const cleanup = await vscode.window.showWarningMessage(
      `Merged ${entry.branch} into ${baseBranch}. Remove the worktree and delete the branch?`,
      { modal: true }, 'Remove Worktree and Branch',
    );
    if (cleanup === 'Remove Worktree and Branch') {
      const removeResult = removeWorktree(cwd, entry.path, false);
      if (!removeResult.ok) { vscode.window.showErrorMessage(`Failed to remove worktree: ${removeResult.message}`); return; }
      try { execFileSync('git', ['branch', '-d', entry.branch], { cwd, encoding: 'utf8' }); } catch (err) {
        vscode.window.showErrorMessage(`Worktree removed, but failed to delete branch ${entry.branch}: ${(err as Error).message}`);
      }
      await provider.refresh();
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.prune', async () => {
    const cwd = repoCwd();
    if (!cwd) return;
    const baseBranch = getBaseBranch(cwd);
    const { merged, missing } = await pruneCandidates(cwd, baseBranch);
    if (merged.length === 0 && missing.length === 0) {
      vscode.window.showInformationMessage('Nothing to prune.');
      return;
    }

    const items = [
      ...missing.map(e => ({ label: `$(warning) ${e.path}`, description: 'directory missing', entry: e, pickKind: 'missing' as const })),
      ...merged.map(e => ({ label: `$(git-merge) ${e.branch}`, description: `merged into ${baseBranch}`, entry: e, pickKind: 'merged' as const })),
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select worktrees to clean up…', canPickMany: true });
    if (!picked || picked.length === 0) return;

    const confirm = await vscode.window.showWarningMessage(`Clean up ${picked.length} worktree(s)?`, { modal: true }, 'Clean Up');
    if (confirm !== 'Clean Up') return;

    const errors: string[] = [];
    if (picked.some(item => item.pickKind === 'missing')) {
      const pruneResult = pruneWorktrees(cwd);
      if (!pruneResult.ok) errors.push(`Prune failed: ${pruneResult.message}`);
    }
    for (const item of picked) {
      if (item.pickKind === 'merged') {
        const removeResult = removeWorktree(cwd, item.entry.path, false);
        if (!removeResult.ok) { errors.push(`Failed to remove ${item.entry.path}: ${removeResult.message}`); continue; }
        if (item.entry.branch) {
          try { execFileSync('git', ['branch', '-d', item.entry.branch], { cwd, encoding: 'utf8' }); } catch (err) {
            errors.push(`Removed worktree, but failed to delete branch ${item.entry.branch}: ${(err as Error).message}`);
          }
        }
      }
    }
    if (errors.length > 0) vscode.window.showErrorMessage(errors.join('\n'));
    await provider.refresh();
  }));
}
