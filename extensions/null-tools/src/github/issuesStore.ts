'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import { fetchComments, fetchIssues } from './githubApi';
import { filterIssues } from './issueFilter';
import { GithubComment, GithubIssue, GithubRepoRef, IssueFilterOptions, IssueState } from './types';

export type IssuesResult =
  | { status: 'no-workspace' }
  | { status: 'no-remote' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ok'; repo: GithubRepoRef; issues: GithubIssue[]; viewerLogin: string | null };

export class IssuesStore {
  private issues: GithubIssue[] = [];
  private repo: GithubRepoRef | null = null;
  private token: string | null = null;

  async refresh(cwd: string | null, state: IssueState): Promise<IssuesResult> {
    if (!cwd) return { status: 'no-workspace' };

    const repo = getWorkspaceGithubRepo(cwd);
    if (!repo) return { status: 'no-remote' };

    const session = await getGithubSession(false);
    if (!session) return { status: 'signed-out' };

    try {
      const issues = await fetchIssues(repo.owner, repo.repo, state, session.accessToken);
      this.issues = issues;
      this.repo = repo;
      this.token = session.accessToken;
      return { status: 'ok', repo, issues, viewerLogin: session.account.label };
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  }

  getFiltered(opts: IssueFilterOptions): GithubIssue[] {
    return filterIssues(this.issues, opts);
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.issues.find(issue => issue.number === number);
  }

  getComments(issueNumber: number): Promise<GithubComment[]> {
    if (!this.repo) return Promise.resolve([]);
    return fetchComments(this.repo.owner, this.repo.repo, issueNumber, this.token);
  }
}
