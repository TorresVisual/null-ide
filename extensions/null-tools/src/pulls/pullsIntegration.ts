'use strict';

import * as vscode from 'vscode';
import { getAccountsApi } from '../github/githubAuth';
import { makeRunGit } from '../graph/gitRun';
import { checkoutPull } from './pullCheckout';
import { PullContentProvider } from './pullContentProvider';
import { PULL_SCHEME } from './pullDocs';
import { openPullFileDiff } from './pullDiff';
import { PullReview } from './pullReview';
import { PullNode, PullsTreeProvider } from './pullsTreeView';

const FOCUS_REFRESH_MIN_MS = 60_000;

export function registerPullsFeature(context: vscode.ExtensionContext): void {
  const review = new PullReview(context.globalState);
  const tree = new PullsTreeProvider(review);
  const view = vscode.window.createTreeView<PullNode>('null.pullsView', { treeDataProvider: tree });
  tree.onMessage = message => { view.message = message; };
  let lastRefresh = 0;
  const refresh = async (): Promise<void> => { lastRefresh = Date.now(); await tree.refresh(); };

  async function checkout(node: PullNode): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (node.kind !== 'pull' || !cwd) return;
    const { pull } = node;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking out pull request #${pull.number}…` },
      () => checkoutPull(makeRunGit(cwd, 60_000), pull),
    );
    if (result.ok) void vscode.window.showInformationMessage(`On branch ${result.branch}.`);
    else void vscode.window.showErrorMessage(`Could not check out #${pull.number}: ${result.message}`);
    if (result.ok) await refresh(); // moves the ● marker
  }

  context.subscriptions.push(
    review,
    view,
    vscode.workspace.registerTextDocumentContentProvider(PULL_SCHEME, new PullContentProvider()),
    vscode.commands.registerCommand('null.pulls.refresh', refresh),
    vscode.commands.registerCommand('null.pulls.open', () => vscode.commands.executeCommand('null.pullsView.focus')),
    // Test seam for the integration spec (like _null.graph.snapshot): the view's state and row count.
    vscode.commands.registerCommand('_null.pulls.snapshot', async () => {
      if (!tree.loaded) await refresh();
      return { state: tree.state, pulls: (await tree.getChildren()).length };
    }),
    // Only while the view has been shown, and at most once a minute: coming back to the window picks up new PRs and branch changes.
    vscode.window.onDidChangeWindowState(e => {
      if (e.focused && tree.loaded && view.visible && Date.now() - lastRefresh > FOCUS_REFRESH_MIN_MS) void refresh();
    }),
    vscode.commands.registerCommand('null.pulls.checkout', checkout),
    vscode.commands.registerCommand('null.pulls.openOnGitHub', (node: PullNode) => {
      if (node.kind === 'pull') void vscode.env.openExternal(vscode.Uri.parse(node.pull.url));
    }),
    vscode.commands.registerCommand('null.pulls.openFileDiff', (node: PullNode) => {
      if (node.kind === 'file') return openPullFileDiff(node.detail, node.file);
    }),
    vscode.commands.registerCommand('null.pulls.comment', (reply: vscode.CommentReply) => review.submit(reply)),
    // Nothing is fetched until the view is first shown, and nothing polls while it is hidden.
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded) void refresh(); }),
  );
  if (view.visible) void refresh();

  // Binding or importing an account must show up without a manual refresh, but never wakes a view nobody opened.
  const accountsChanged = getAccountsApi()?.onDidChange(() => { if (tree.loaded) void refresh(); });
  if (accountsChanged) context.subscriptions.push(accountsChanged);
}
