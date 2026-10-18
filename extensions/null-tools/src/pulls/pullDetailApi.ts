'use strict';

import { requestGraphql, requestJson } from '../github/githubApi';
import { PULL_PAGE, PullPage, PullPageData, mapPullPage } from './pullDetailModel';

export async function fetchPullPage(owner: string, repo: string, number: number, token: string | null): Promise<PullPage> {
  return mapPullPage(await requestGraphql<PullPageData>(PULL_PAGE, { owner, name: repo, number }, token));
}

export interface RerunResult { started: number; errors: string[] }

/** One POST per workflow run, in order; a run GitHub refuses (still running, no Actions permission) is reported and the rest still go. */
export async function rerunFailedRuns(owner: string, repo: string, runIds: number[], token: string | null): Promise<RerunResult> {
  const result: RerunResult = { started: 0, errors: [] };
  for (const id of runIds) {
    try {
      await requestJson(`/repos/${owner}/${repo}/actions/runs/${id}/rerun-failed-jobs`, token, 'POST', {});
      result.started++;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}
