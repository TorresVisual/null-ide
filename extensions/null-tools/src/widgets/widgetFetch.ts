'use strict';

import { ApiError } from '../github/githubApi';
import { WIDGET_QUERY, WidgetData, LocalPaths, chunkRepos, mapIssues, mapPrs, searchStrings } from './widgetQueries';
import { IssueRow, PrRow, Reason } from './widgetTypes';

export type RepoResult =
  | { repo: string; issues: IssueRow[]; prs: PrRow[] }
  | { repo: string; reason: Reason; retryAt?: number | null };

export interface FetchDeps {
  token(accountId: string): Promise<string | undefined>;
  graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>;
  localPaths(): LocalPaths;
}

const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const PER_SEARCH = 20;                                    // comfortably above the row maxima after merging and de-duplicating

export function classifyError(err: unknown): { reason: Reason; retryAt: number | null } {
  if (err instanceof ApiError) {
    if (err.retryAt !== null) { return { reason: 'error', retryAt: err.retryAt }; }
    return { reason: err.status === 401 ? 'signed_out' : 'error', retryAt: null };
  }
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return { reason: code && OFFLINE.has(code) ? 'offline' : 'error', retryAt: null };
}

export async function fetchRepos(deps: FetchDeps, accountId: string, repos: string[]): Promise<RepoResult[]> {
  const token = await deps.token(accountId);
  if (!token) { return repos.map(repo => ({ repo, reason: 'signed_out' as const })); }
  const local = deps.localPaths();
  const results: RepoResult[] = [];
  for (const chunk of chunkRepos(repos)) {
    try {
      const data = await deps.graphql<WidgetData>(WIDGET_QUERY, { ...searchStrings(chunk), n: PER_SEARCH }, token);
      const issues = mapIssues(data, local), prs = mapPrs(data, local);
      for (const repo of chunk) {
        const key = repo.toLowerCase();
        results.push({ repo, issues: issues.filter(i => i.repo.toLowerCase() === key), prs: prs.filter(p => p.repo.toLowerCase() === key) });
      }
    } catch (err) {
      const { reason, retryAt } = classifyError(err);
      for (const repo of chunk) { results.push({ repo, reason, retryAt }); }
    }
  }
  return results;
}
