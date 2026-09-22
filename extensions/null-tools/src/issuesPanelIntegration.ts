'use strict';

import * as vscode from 'vscode';
import { IssuesStore } from './github/issuesStore';
import { IssuesViewProvider } from './issuesPanel';
import { getWorkspaceGithubRepo } from './github/githubRemote';

export function registerIssuesPanelFeature(context: vscode.ExtensionContext): void {
  const store = new IssuesStore();
  const provider = new IssuesViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.create', () => provider.createIssue()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.refresh', () => provider.refresh()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.signIn', () => provider.signIn()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.linkFromCommitMessage', linkFromCommitMessage),
  );
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

  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) { void vscode.window.showErrorMessage('Built-in git extension not found.'); return; }
  const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
  const scmRepo = git.repositories.find((r: { rootUri: vscode.Uri }) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
  const message: string = scmRepo?.inputBox.value ?? '';

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
