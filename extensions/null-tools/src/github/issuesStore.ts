'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import {
  createComment, createIssue, deleteComment, fetchAssignableUsers, fetchComments, fetchIssue, fetchIssues, fetchRepoLabels,
  fetchTimeline, updateComment, updateIssue,
} from './githubApi';
import { filterIssues } from './issueFilter';
import {
  GithubComment, GithubIssue, GithubLabel, GithubRepoRef, GithubTimelineEvent, GithubUser, IssueFilterOptions,
  IssueState,
} from './types';

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
  private repoLabels: GithubLabel[] | null = null;
  private assignableUsers: GithubUser[] | null = null;
  private viewerLogin: string | null = null;

  /** Seeds in-memory state from a persisted cache, without a network call. */
  hydrateFromCache(repo: GithubRepoRef, issues: GithubIssue[], viewerLogin: string | null): void {
    this.repo = repo;
    this.issues = issues;
    this.viewerLogin = viewerLogin;
  }

  async refresh(cwd: string | null, state: IssueState): Promise<IssuesResult> {
    if (!cwd) return { status: 'no-workspace' };

    const repo = getWorkspaceGithubRepo(cwd);
    if (!repo) return { status: 'no-remote' };

    const session = await getGithubSession(false);
    if (!session) return { status: 'signed-out' };

    if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
      this.repoLabels = null;
      this.assignableUsers = null;
    }

    try {
      const issues = await fetchIssues(repo.owner, repo.repo, state, session.accessToken);
      this.issues = issues;
      this.repo = repo;
      this.token = session.accessToken;
      this.viewerLogin = session.account.label;
      return { status: 'ok', repo, issues, viewerLogin: session.account.label };
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  }

  async getRepoLabels(): Promise<GithubLabel[]> {
    if (!this.repo) return [];
    if (!this.repoLabels) this.repoLabels = await fetchRepoLabels(this.repo.owner, this.repo.repo, this.token);
    return this.repoLabels;
  }

  async getAssignableUsers(): Promise<GithubUser[]> {
    if (!this.repo) return [];
    if (!this.assignableUsers) {
      this.assignableUsers = await fetchAssignableUsers(this.repo.owner, this.repo.repo, this.token);
    }
    return this.assignableUsers;
  }

  getFiltered(opts: IssueFilterOptions): GithubIssue[] {
    return filterIssues(this.issues, opts);
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.issues.find(issue => issue.number === number);
  }

  getAllIssues(): GithubIssue[] {
    return this.issues;
  }

  getRepo(): GithubRepoRef | null {
    return this.repo;
  }

  getViewerLogin(): string | null {
    return this.viewerLogin;
  }

  getComments(issueNumber: number): Promise<GithubComment[]> {
    if (!this.repo) return Promise.resolve([]);
    return fetchComments(this.repo.owner, this.repo.repo, issueNumber, this.token);
  }

  getTimeline(issueNumber: number): Promise<GithubTimelineEvent[]> {
    if (!this.repo) return Promise.resolve([]);
    return fetchTimeline(this.repo.owner, this.repo.repo, issueNumber, this.token);
  }

  /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching the whole list. */
  async reloadIssue(issueNumber: number): Promise<void> {
    if (!this.repo) return;
    const fresh = await fetchIssue(this.repo.owner, this.repo.repo, issueNumber, this.token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? fresh : issue));
  }

  async updateIssue(
    issueNumber: number,
    patch: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue | null> {
    if (!this.repo) return null;
    const updated = await updateIssue(this.repo.owner, this.repo.repo, issueNumber, patch, this.token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? updated : issue));
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue | null> {
    if (!this.repo) return null;
    const created = await createIssue(this.repo.owner, this.repo.repo, data, this.token);
    this.issues = [created, ...this.issues];
    return created;
  }

  async addComment(issueNumber: number, body: string): Promise<GithubComment | null> {
    if (!this.repo) return null;
    const comment = await createComment(this.repo.owner, this.repo.repo, issueNumber, body, this.token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: issue.comments + 1 } : issue,
    );
    return comment;
  }

  async updateComment(commentId: number, body: string): Promise<GithubComment | null> {
    if (!this.repo) return null;
    return updateComment(this.repo.owner, this.repo.repo, commentId, body, this.token);
  }

  async deleteComment(issueNumber: number, commentId: number): Promise<void> {
    if (!this.repo) return;
    await deleteComment(this.repo.owner, this.repo.repo, commentId, this.token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: Math.max(0, issue.comments - 1) } : issue,
    );
  }
}
