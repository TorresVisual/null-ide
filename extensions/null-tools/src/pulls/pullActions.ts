'use strict';

import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { MergeMethod, ReviewChoice, reviewBodyError, reviewChoices } from './pullActionsModel';
import { PullPage } from './pullDetailModel';
import { mergePull, setPullDraft, setPullOpen } from './pullLifecycleApi';
import { describeFailure } from './pullModel';
import { ReviewEvent, ReviewState, discardReview, fetchReviewState, submitNewReview, submitReview } from './pullReviewApi';

/** `changed`: GitHub accepted a write. `failed`: it refused (already shown). `cancelled`: the user backed out, nothing happened. */
export type Outcome = 'changed' | 'failed' | 'cancelled';
export type PageAction = 'review' | 'merge' | 'close' | 'reopen' | 'ready' | 'draft';
/** What the panel accepts from the webview; anything else is ignored. */
export const PAGE_ACTIONS: ReadonlySet<string> = new Set<PageAction>(['review', 'merge', 'close', 'reopen', 'ready', 'draft']);

export interface PullTarget { owner: string; repo: string; number: number }

const METHOD_LABELS: Record<MergeMethod, string> = {
  MERGE: 'Create a merge commit', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge',
};

async function token(): Promise<string | null> {
  return (await getGithubSession(true))?.accessToken ?? null;
}

function fail(what: string, err: unknown): Outcome {
  void vscode.window.showErrorMessage(`Could not ${what}: ${describeFailure(err)}`);
  return 'failed';
}

/** Ends the viewer's review: comment / approve / request changes (submitting any pending comments with it), or discard it. */
export async function finishReview(target: PullTarget): Promise<Outcome> {
  const t = await token();
  if (!t) return 'cancelled';
  let state: ReviewState;
  try {
    state = await fetchReviewState(target.owner, target.repo, target.number, t);
  } catch (err) {
    return fail(`load the review of #${target.number}`, err);
  }
  const picked = await vscode.window.showQuickPick(
    reviewChoices(state).map(o => ({ label: o.label, description: o.description, choice: o.choice })),
    { title: `Review #${target.number}`, placeHolder: 'How do you want to finish your review?' },
  );
  if (!picked) return 'cancelled';
  const choice: ReviewChoice = picked.choice;
  try {
    if (choice === 'DISCARD') {
      const sure = await vscode.window.showWarningMessage(
        `Discard your ${state.comments} unsent comment${state.comments === 1 ? '' : 's'} on #${target.number}?`, { modal: true }, 'Discard');
      if (!sure || state.reviewId === null) return 'cancelled';
      await discardReview(state.reviewId, t);
      void vscode.window.showInformationMessage('Pending review discarded.');
      return 'changed';
    }
    const event: ReviewEvent = choice;
    const body = await vscode.window.showInputBox({
      title: `${picked.label} · #${target.number}`,
      prompt: event === 'APPROVE' ? 'Optional summary' : 'Summary',
      validateInput: v => reviewBodyError(event, state.comments, v),
    });
    if (body === undefined) return 'cancelled';
    if (state.reviewId === null) await submitNewReview(state, event, body.trim(), t);
    else await submitReview(state.reviewId, event, body.trim(), t);
    void vscode.window.showInformationMessage(`Review submitted on #${target.number}.`);
    return 'changed';
  } catch (err) {
    return fail(`submit the review of #${target.number}`, err);
  }
}

async function merge(page: PullPage): Promise<Outcome> {
  const methods = page.actions.merge.methods;
  const method: MergeMethod | undefined = methods.length === 1 ? methods[0]
    : (await vscode.window.showQuickPick(
      methods.map(m => ({ label: METHOD_LABELS[m], method: m })), { title: `Merge #${page.number}`, placeHolder: 'How should it be merged?' }))?.method;
  if (!method) return 'cancelled';
  const sure = await vscode.window.showWarningMessage(
    `${METHOD_LABELS[method]}: #${page.number} into ${page.baseRef}?`, { modal: true, detail: page.title }, 'Merge');
  if (!sure) return 'cancelled';
  const t = await token();
  if (!t) return 'cancelled';
  try {
    await mergePull(page.id, method, page.headSha, t); // pinned to the head this page showed
    void vscode.window.showInformationMessage(`Merged #${page.number} into ${page.baseRef}.`);
    return 'changed';
  } catch (err) {
    return fail(`merge #${page.number}`, err);
  }
}

/** Close / reopen / draft: reversible, so no confirmation. */
async function changeState(action: 'close' | 'reopen' | 'ready' | 'draft', page: PullPage): Promise<Outcome> {
  const t = await token();
  if (!t) return 'cancelled';
  try {
    if (action === 'close' || action === 'reopen') await setPullOpen(page.id, action === 'reopen', t);
    else await setPullDraft(page.id, action === 'draft', t);
    return 'changed';
  } catch (err) {
    const what = { close: 'close', reopen: 'reopen', ready: 'mark as ready', draft: 'convert to a draft' }[action];
    return fail(`${what} #${page.number}`, err);
  }
}

/** Runs one tab action. The host trusts its own loaded `page.actions`, never the webview: an action the page did not offer does nothing. */
export async function runAction(action: PageAction, target: PullTarget, page: PullPage): Promise<Outcome> {
  const a = page.actions;
  switch (action) {
    case 'review': return a.review.available ? finishReview(target) : 'cancelled';
    case 'merge': return a.merge.enabled ? merge(page) : 'cancelled';
    case 'close': case 'reopen': return a.state === action ? changeState(action, page) : 'cancelled';
    case 'ready': case 'draft': return a.draft === action ? changeState(action, page) : 'cancelled';
  }
}
