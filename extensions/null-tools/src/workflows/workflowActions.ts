'use strict';

import * as vscode from 'vscode';
import { fetchRepoFile } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { resolveGithubSession } from '../github/githubSession';
import { DispatchInput, parseDispatch, validateInput } from './dispatchInputs';
import * as api from './workflowsApi';
import { RunAction, WfNode, actionFailureText, branchChoices, isPlausibleRef, refusal } from './workflowsModel';
import { RepoSlot, WorkflowsTreeProvider } from './workflowsTreeView';

const MAX_WORKFLOW_BYTES = 256 * 1024;
const DISPATCH_REFRESH_MS = 3000; // GitHub does not return the new run id, so look again shortly

/** The token for a write: the one the tree has, or an interactive sign-in for this folder. */
async function writeToken(slot: RepoSlot): Promise<string | null> {
  if (slot.token) return slot.token;
  const session = await resolveGithubSession(getAccountsApi(), slot.folder, true);
  slot.token = session?.accessToken ?? null;
  return slot.token;
}

const LABELS: Record<RunAction, string> = {
  rerunAll: 'Re-run all jobs', rerunFailed: 'Re-run failed jobs', rerunJob: 'Re-run job', cancel: 'Cancel run',
};
const CONFIRM: Partial<Record<RunAction, string>> = { rerunAll: 'Re-run all jobs of this run?', cancel: 'Cancel this run?' };

/** Re-reads the target, refuses a stale click with the reason, confirms where the spec says so, then calls the API. */
export async function runAction(tree: WorkflowsTreeProvider, node: WfNode, action: RunAction): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || (node.kind !== 'run' && node.kind !== 'job')) return;
  const token = await writeToken(slot);
  if (!token) return;
  const { owner, repo } = slot;
  const id = node.kind === 'run' ? node.run.id : node.job.id;
  try {
    const fresh = node.kind === 'run' ? await api.getRun(owner, repo, id, token) : await api.getJob(owner, repo, id, token);
    const reason = refusal(action, fresh);
    if (reason) {
      void vscode.window.showWarningMessage(`${LABELS[action]}: ${reason}`);
      await tree.reloadRuns(slot);
      return;
    }
    const question = CONFIRM[action];
    if (question && !await vscode.window.showWarningMessage(question, { modal: true }, LABELS[action])) return;
    switch (action) {
      case 'rerunAll': await api.rerunRun(owner, repo, id, token); break;
      case 'rerunFailed': await api.rerunFailedJobs(owner, repo, id, token); break;
      case 'rerunJob': await api.rerunJob(owner, repo, id, token); break;
      case 'cancel': await api.cancelRun(owner, repo, id, token); break;
    }
    void vscode.window.showInformationMessage(`${LABELS[action]}: requested.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`${LABELS[action]}: ${actionFailureText(err)}`);
  }
  slot.jobs.clear(); // a re-run starts a new attempt: reload jobs when the rows are opened again
  await tree.reloadRuns(slot);
}

export async function enable(tree: WorkflowsTreeProvider, node: WfNode): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || node.kind !== 'workflow') return;
  const token = await writeToken(slot);
  if (!token) return;
  if (!await vscode.window.showWarningMessage(`Enable the workflow "${node.workflow.name}"?`, { modal: true }, 'Enable')) return;
  try {
    await api.enableWorkflow(slot.owner, slot.repo, node.workflow.id, token);
    void vscode.window.showInformationMessage(`${node.workflow.name} is enabled.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Enable workflow: ${actionFailureText(err)}`);
  }
  await tree.refresh();
}

/** A branch (or any typed ref), then one prompt per `workflow_dispatch` input read from the YAML at that ref. */
async function pickRef(slot: RepoSlot, token: string, title: string): Promise<string | undefined> {
  const branches = await api.listBranches(slot.owner, slot.repo, token).catch(() => [] as string[]);
  const choices = branchChoices(branches, slot.branch);
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
  qp.title = title;
  qp.placeholder = 'Branch or tag to run on (type to use any ref)';
  const base: vscode.QuickPickItem[] = choices.map(label => ({ label }));
  qp.items = base;
  qp.onDidChangeValue(value => {
    const typed = value.trim();
    qp.items = typed && !choices.includes(typed) && isPlausibleRef(typed) ? [{ label: typed, description: 'use this ref' }, ...base] : base;
  });
  return new Promise<string | undefined>(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.label); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
}

async function askInput(workflow: string, input: DispatchInput): Promise<string | undefined> {
  const title = `${workflow}: ${input.name}`;
  if (input.type === 'boolean' || input.type === 'choice') {
    const options = input.type === 'boolean' ? ['true', 'false'] : input.options;
    const items = options.map(label => ({ label, description: label === input.default ? 'default' : '' }));
    return (await vscode.window.showQuickPick(items, { title, placeHolder: input.description || input.name }))?.label;
  }
  return vscode.window.showInputBox({
    title, prompt: input.description || undefined, value: input.default ?? '',
    validateInput: v => validateInput(input, v),
  });
}

export async function dispatch(tree: WorkflowsTreeProvider, node: WfNode): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || node.kind !== 'workflow') return;
  const token = await writeToken(slot);
  if (!token) return;
  const { workflow } = node;
  const ref = await pickRef(slot, token, `Run ${workflow.name}`);
  if (!ref) return;
  let inputs: DispatchInput[];
  try {
    const file = await fetchRepoFile(slot.owner, slot.repo, ref, workflow.path, token, MAX_WORKFLOW_BYTES);
    const parsed = parseDispatch(file.bytes.toString('utf8'));
    if (!parsed.dispatchable) {
      void vscode.window.showWarningMessage(`${workflow.name} has no workflow_dispatch trigger at ${ref}.`);
      return;
    }
    inputs = parsed.inputs;
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not read ${workflow.path} at ${ref}: ${actionFailureText(err)}`);
    return;
  }
  const values: Record<string, string> = {};
  for (const input of inputs) {
    const value = await askInput(workflow.name, input);
    if (value === undefined) return; // Escape anywhere cancels the whole dispatch
    if (value !== '') values[input.name] = value;
  }
  try {
    await api.dispatchWorkflow(slot.owner, slot.repo, workflow.id, ref, values, token);
    void vscode.window.showInformationMessage(`Started ${workflow.name} on ${ref}.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Run workflow: ${actionFailureText(err)}`);
  }
  setTimeout(() => void tree.reloadRuns(slot), DISPATCH_REFRESH_MS);
}
