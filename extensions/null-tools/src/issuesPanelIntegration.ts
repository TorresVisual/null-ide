'use strict';

import * as vscode from 'vscode';
import { IssuesStore } from './github/issuesStore';
import { IssuesViewProvider } from './issuesPanel';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { getGithubSession } from './github/githubAuth';
import { fetchIssues } from './github/githubApi';
import { GithubIssue } from './github/types';

export function registerIssuesPanelFeature(context: vscode.ExtensionContext): void {
  const store = new IssuesStore(() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
  const provider = new IssuesViewProvider(context.extensionUri, store, context.globalState);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.create', () => provider.createIssue()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.openFullView', () => provider.openFullView()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.refresh', async () => {
      await provider.refresh();
      await refreshIssueCountBar();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.signIn', async () => {
      await provider.signIn();
      await refreshIssueCountBar();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.markRead', () => provider.markRead()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.linkFromCommitMessage', linkFromCommitMessage),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.insertReference', insertIssueReference),
  );

  const countBar = vscode.window.createStatusBarItem('null.issuesCount', vscode.StatusBarAlignment.Left, 4);
  countBar.command = 'null.issuesView.focus';
  context.subscriptions.push(countBar);

  async function refreshIssueCountBar(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const repo = cwd ? getWorkspaceGithubRepo(cwd) : null;
    if (!repo) { countBar.hide(); return; }

    const session = await getGithubSession(false);
    if (!session) { countBar.hide(); return; }

    try {
      const issues = await fetchIssues(repo.owner, repo.repo, 'open', session.accessToken);
      const mine = issues.filter(issue => issue.assignees.some(a => a.login === session.account.label)).length;
      countBar.text = mine > 0 ? `$(issues) ${issues.length} (${mine} mine)` : `$(issues) ${issues.length}`;
      countBar.tooltip = `${issues.length} open issue${issues.length === 1 ? '' : 's'} in ${repo.owner}/${repo.repo}`
        + (mine > 0 ? ` (${mine} assigned to you)` : '');
      countBar.show();
    } catch {
      countBar.hide();
    }
  }

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => refreshIssueCountBar()));
  void refreshIssueCountBar();
}

// ponytail: VS Code's SCM input box exposes only `.value` (a string) to
// third-party extensions — there's no public document/URI to register a
// DocumentLinkProvider against (that needs a proposed API the built-in
// GitHub PR/Issues extension gets but we don't). This quick-pick, triggered
// from the SCM title bar, is the documented fallback in the design spec.
async function linkFromCommitMessage(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { void vscode.window.showErrorMessage('Open a folder first.'); return; }
  const cwd = folders[0].uri.fsPath;

  const repo = getWorkspaceGithubRepo(cwd);
  if (!repo) { void vscode.window.showInformationMessage('This folder has no GitHub remote.'); return; }

  const scmRepo = await getScmRepo(cwd);
  if (!scmRepo) return;
  const message: string = scmRepo.inputBox.value ?? '';

  const numbers = [...new Set([...message.matchAll(/#(\d+)/g)].map(m => Number(m[1])))];
  if (numbers.length === 0) {
    void vscode.window.showInformationMessage('No issue references (#N) found in the commit message.');
    return;
  }

  let number: number | undefined = numbers[0];
  if (numbers.length > 1) {
    const picked = await vscode.window.showQuickPick(numbers.map(String), { placeHolder: 'Open which referenced issue?' });
    number = picked ? Number(picked) : undefined;
  }
  if (number === undefined) return;

  await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${repo.owner}/${repo.repo}/issues/${number}`));
}

// Reverse of linkFromCommitMessage: pick an open issue and a reference style,
// then insert it into the SCM input box instead of parsing it back out.
async function insertIssueReference(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { void vscode.window.showErrorMessage('Open a folder first.'); return; }
  const cwd = folders[0].uri.fsPath;

  const repo = getWorkspaceGithubRepo(cwd);
  if (!repo) { void vscode.window.showInformationMessage('This folder has no GitHub remote.'); return; }

  const scmRepo = await getScmRepo(cwd);
  if (!scmRepo) return;

  const session = await getGithubSession(true);
  if (!session) return;

  let issues: GithubIssue[];
  try {
    issues = await fetchIssues(repo.owner, repo.repo, 'open', session.accessToken);
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to fetch issues: ${(err as Error).message}`);
    return;
  }
  if (issues.length === 0) { void vscode.window.showInformationMessage('No open issues found.'); return; }

  const pickedIssue = await vscode.window.showQuickPick(
    issues.map(issue => ({ label: `#${issue.number}`, description: issue.title, issue })),
    { placeHolder: 'Reference which issue?' },
  );
  if (!pickedIssue) return;
  const n = pickedIssue.issue.number;

  const style = await vscode.window.showQuickPick(
    [
      { label: `#${n}`, description: 'Reference only' },
      { label: `Closes #${n}`, description: 'Closes the issue once this commit reaches the default branch' },
      { label: `Fixes #${n}`, description: 'Fixes the issue once this commit reaches the default branch' },
    ],
    { placeHolder: 'Reference style?' },
  );
  if (!style) return;

  const current = scmRepo.inputBox.value;
  scmRepo.inputBox.value = current ? `${current}\n\n${style.label}` : style.label;
}

async function getScmRepo(cwd: string): Promise<{ inputBox: { value: string } } | undefined> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) { void vscode.window.showErrorMessage('Built-in git extension not found.'); return undefined; }
  const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
  return git.repositories.find((r: { rootUri: vscode.Uri }) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
}
