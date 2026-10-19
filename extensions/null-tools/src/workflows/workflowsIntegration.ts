'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { fetchRepoFile } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { resolveGithubSession } from '../github/githubSession';
import { getGitApi } from '../graph/gitApi';
import { describeFailure } from '../pulls/pullModel';
import { editFilter } from './workflowFilterMenu';
import { POLL_FAST_MS, RunFilter, WfNode, isWorkflowFile } from './workflowsModel';
import { WorkflowsTreeProvider } from './workflowsTreeView';

const MAX_WORKFLOW_FILE_BYTES = 256 * 1024;
const FOCUS_REFRESH_MIN_MS = 60_000;

export function registerWorkflowsFeature(context: vscode.ExtensionContext): void {
  const tree = new WorkflowsTreeProvider(context.workspaceState);
  const view = vscode.window.createTreeView<WfNode>('null.workflowsView', { treeDataProvider: tree });
  tree.onMessage = message => { view.message = message; };
  let lastRefresh = 0;
  const refresh = async (): Promise<void> => { lastRefresh = Date.now(); await tree.refresh(); };

  // One shared timer, only while the view is visible, only while some run is in play.
  let timer: NodeJS.Timeout | undefined;
  const stop = (): void => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const schedule = (ms: number | null): void => {
    stop();
    if (ms !== null && view.visible) timer = setTimeout(() => void tick(), ms);
  };
  const tick = async (): Promise<void> => {
    timer = undefined;
    schedule(await tree.poll());
  };
  const rearm = (): void => { if (!timer && view.visible && tree.hasActiveRuns()) schedule(POLL_FAST_MS); };

  const workflowFiles = (): Array<{ file: string; name: string }> => {
    const seen = new Map<string, string>();
    for (const s of tree.slots()) for (const w of s.workflows) seen.set(path.posix.basename(w.path), w.name);
    return [...seen].map(([file, name]) => ({ file, name }));
  };
  async function applyFilter(next: RunFilter): Promise<void> {
    lastRefresh = Date.now();
    await tree.setFilter(next);
  }

  async function signIn(node: WfNode): Promise<void> {
    const slot = tree.slot(node.repo.key);
    if (!slot) return;
    // The only interactive call: the user clicked the row for this folder.
    const session = await resolveGithubSession(getAccountsApi(), slot.folder, true);
    if (session) await refresh();
  }

  async function openWorkflowFile(node: WfNode): Promise<void> {
    const slot = tree.slot(node.repo.key);
    if (node.kind !== 'workflow' || !slot) return;
    const local = vscode.Uri.joinPath(slot.folder, node.workflow.path);
    try {
      await vscode.workspace.fs.stat(local);
      await vscode.window.showTextDocument(local);
      return;
    } catch { /* not on disk: read it from GitHub */ }
    try {
      const file = await fetchRepoFile(slot.owner, slot.repo, 'HEAD', node.workflow.path, slot.token, MAX_WORKFLOW_FILE_BYTES);
      const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: file.bytes.toString('utf8') });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open ${path.posix.basename(node.workflow.path)}: ${describeFailure(err)}`);
    }
  }

  context.subscriptions.push(
    view,
    vscode.commands.registerCommand('null.workflows.refresh', refresh),
    vscode.commands.registerCommand('null.workflows.open', () => vscode.commands.executeCommand('null.workflowsView.focus')),
    vscode.commands.registerCommand('null.workflows.signIn', signIn),
    vscode.commands.registerCommand('null.workflows.loadMore', async (node: WfNode) => {
      const slot = tree.slot(node.repo.key);
      if (slot) await tree.loadMore(slot);
    }),
    vscode.commands.registerCommand('null.workflows.openOnGitHub', (node: WfNode) => {
      const url = node.kind === 'run' ? node.run.url : node.kind === 'job' ? node.job.url
        : node.kind === 'workflow' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions/workflows/${path.posix.basename(node.workflow.path)}`
          : node.kind === 'repo' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions` : '';
      if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('null.workflows.openWorkflowFile', openWorkflowFile),
    vscode.commands.registerCommand('null.workflows.createWorkflow', async (node: WfNode) => {
      const slot = tree.slot(node.repo.key);
      if (!slot) return;
      const dir = vscode.Uri.joinPath(slot.folder, '.github', 'workflows');
      try {
        await vscode.workspace.fs.stat(dir);
        await vscode.commands.executeCommand('revealInExplorer', dir);
      } catch {
        void vscode.window.showInformationMessage('Create .github/workflows/ in this folder and add a YAML workflow file to it.');
      }
    }),
    vscode.commands.registerCommand('null.workflows.filter', async () => {
      if (tree.state !== 'ready') {
        void vscode.window.showInformationMessage('Open the GitHub Actions view of a folder with a GitHub remote first.');
        return;
      }
      const next = await editFilter(tree.filter, workflowFiles);
      if (next) await applyFilter(next);
    }),
    vscode.commands.registerCommand('null.workflows.filterByWorkflow', async (node: WfNode) => {
      if (node.kind === 'workflow') {
        const file = path.posix.basename(node.workflow.path);
        if (isWorkflowFile(file)) await applyFilter({ ...tree.filter, workflow: file });
      }
    }),
    // Test seam for the integration spec (like _null.pulls.snapshot): the view's state and per-repo counts.
    vscode.commands.registerCommand('_null.workflows.snapshot', async () => {
      await tree.ensureLoaded();
      return tree.snapshot();
    }),
    tree.onDidLoad(rearm),
    // Nothing is fetched until the view is first shown.
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded) void refresh(); }),
    view.onDidChangeVisibility(e => { if (e.visible) rearm(); else stop(); }),
    { dispose: stop },
    // Coming back to the window picks up new runs, at most once a minute and only while the view is shown.
    vscode.window.onDidChangeWindowState(e => {
      if (e.focused && tree.loaded && view.visible && Date.now() - lastRefresh > FOCUS_REFRESH_MIN_MS) void refresh();
    }),
  );
  if (view.visible) void refresh();

  // Binding or importing an account must show up without a manual refresh, but never wakes a view nobody opened.
  const accountsChanged = getAccountsApi()?.onDidChange(() => { if (tree.loaded) void refresh(); });
  if (accountsChanged) context.subscriptions.push(accountsChanged);

  // The branch marker follows vscode.git: one cheap `symbolic-ref` per repo, and a redraw only when a branch really changed.
  void getGitApi().then(git => {
    const subs = git.repositories.map(r => r.state.onDidChange(() => { if (view.visible && tree.loaded) void tree.refreshBranches(); }));
    context.subscriptions.push(...subs);
  }, () => undefined);
}
