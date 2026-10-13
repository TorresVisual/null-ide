'use strict';

import * as vscode from 'vscode';
import { IssuesStore } from './github/issuesStore';
import { IssuesViewProvider } from './issuesPanel';
import { IssueDetailPanel } from './issueDetailPanel';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { getAccountsApi, getGithubSession } from './github/githubAuth';
import { fetchIssues } from './github/githubApi';
import { GithubIssue } from './github/types';
import { branchIssueTracker } from './github/gitBranch';

export function registerIssuesPanelFeature(context: vscode.ExtensionContext): void {
  const store = new IssuesStore(() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
  const provider = new IssuesViewProvider(context.extensionUri, store, context.globalState);
  IssueDetailPanel.configure(context.workspaceState, issue => provider.insertCreated(issue));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.create', () => provider.createIssue()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.focus', () => vscode.commands.executeCommand('workbench.view.extension.null-issues')),
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

  watchIssueBranches(context, store);

  const countBar = vscode.window.createStatusBarItem('null.issuesCount', vscode.StatusBarAlignment.Left, 4);
  countBar.command = 'null.issuesView.focus';
  context.subscriptions.push(countBar);

  async function refreshIssueCountBar(): Promise<void> {
    try {
      const { repo, open, mine } = await store.getOpenCounts();
      countBar.text = mine > 0 ? `$(issues) ${open} (${mine} mine)` : `$(issues) ${open}`;
      countBar.tooltip = `${open} open issue${open === 1 ? '' : 's'} in ${repo.owner}/${repo.repo}`
        + (mine > 0 ? ` (${mine} assigned to you)` : '');
      countBar.show();
    } catch {
      countBar.hide(); // no folder, no GitHub remote, signed out, offline: nothing trustworthy to show
    }
  }

  // GitHub's search index lags a few seconds behind writes, so a change waits before re-counting, and bursts collapse.
  let recount: ReturnType<typeof setTimeout> | undefined;
  const scheduleRecount = (): void => {
    clearTimeout(recount);
    recount = setTimeout(() => void refreshIssueCountBar(), 3000);
  };
  const REFRESH_MS = 5 * 60 * 1000;
  const poll = setInterval(() => void refreshIssueCountBar(), REFRESH_MS);
  context.subscriptions.push(
    { dispose: store.onDidChange(scheduleRecount) },
    { dispose: () => { clearTimeout(recount); clearInterval(poll); } },
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshIssueCountBar()),
    vscode.window.onDidChangeWindowState(state => { if (state.focused) void refreshIssueCountBar(); }),
  );
  // Importing or binding an account must show up without a manual refresh.
  const accountsChanged = getAccountsApi()?.onDidChange(() => {
    void provider.refresh();
    void refreshIssueCountBar();
  });
  if (accountsChanged) { context.subscriptions.push(accountsChanged); }
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

interface GitRepo {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string }; onDidChange: vscode.Event<void> };
}

/** #54: offer to open the issue when the user switches to an `issue-<n>-…` branch. */
function watchIssueBranches(context: vscode.ExtensionContext, store: IssuesStore): void {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) return;

  const sameRepoAsWorkspace = (root: string): boolean => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mine = cwd ? getWorkspaceGithubRepo(cwd) : null;
    const theirs = getWorkspaceGithubRepo(root);
    return !!mine && !!theirs && mine.owner === theirs.owner && mine.repo === theirs.repo;
  };

  const offer = async (n: number): Promise<void> => {
    let title: string;
    try {
      title = (await store.getDetail(n)).issue.title;
    } catch {
      return; // signed out, offline, a PR number, a deleted issue: a courtesy prompt stays quiet
    }
    const pick = await vscode.window.showInformationMessage(`Branch refers to #${n}: ${title}`, 'Open', 'Not now');
    if (pick === 'Open') await IssueDetailPanel.show(context.extensionUri, store, n);
  };

  const watch = (repo: GitRepo): void => {
    const root = repo.rootUri.fsPath;
    branchIssueTracker.onHead(root, repo.state.HEAD?.name); // records the starting branch
    context.subscriptions.push(repo.state.onDidChange(() => {
      const n = branchIssueTracker.onHead(root, repo.state.HEAD?.name);
      if (n !== null && sameRepoAsWorkspace(root)) void offer(n);
    }));
  };

  void (async () => {
    try {
      const git = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
      (git.repositories as GitRepo[]).forEach(watch);
      context.subscriptions.push(git.onDidOpenRepository(watch));
    } catch {
      // git extension disabled: no branch prompts
    }
  })();
}
