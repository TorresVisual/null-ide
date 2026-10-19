'use strict';

import { requestGraphql } from '../github/githubApi';
import { MergeMethod } from './pullActionsModel';

const MERGE = `
mutation Merge($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { merged } } }`;

/** `expectedHeadSha` makes GitHub refuse when the branch moved since the page was loaded. Default commit message; the branch is kept. */
export async function mergePull(pullId: string, method: MergeMethod, expectedHeadSha: string, token: string | null): Promise<void> {
  await requestGraphql(MERGE, { input: { pullRequestId: pullId, mergeMethod: method, expectedHeadOid: expectedHeadSha } }, token);
}

const CLOSE = `
mutation Close($input: ClosePullRequestInput!) { closePullRequest(input: $input) { pullRequest { state } } }`;
const REOPEN = `
mutation Reopen($input: ReopenPullRequestInput!) { reopenPullRequest(input: $input) { pullRequest { state } } }`;

export async function setPullOpen(pullId: string, open: boolean, token: string | null): Promise<void> {
  await requestGraphql(open ? REOPEN : CLOSE, { input: { pullRequestId: pullId } }, token);
}

const TO_DRAFT = `
mutation ToDraft($input: ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input: $input) { pullRequest { isDraft } } }`;
const TO_READY = `
mutation ToReady($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { pullRequest { isDraft } } }`;

export async function setPullDraft(pullId: string, draft: boolean, token: string | null): Promise<void> {
  await requestGraphql(draft ? TO_DRAFT : TO_READY, { input: { pullRequestId: pullId } }, token);
}
