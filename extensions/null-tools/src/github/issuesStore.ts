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

type SessionStatus = 'no-workspace' | 'no-remote' | 'signed-out';

const SESSION_MESSAGES: Record<SessionStatus, string> = {
  'no-workspace': 'Open a folder to use GitHub issues.',
  'no-remote': 'This folder has no GitHub remote.',
  'signed-out': 'Sign in to GitHub to continue.',
};

/** Why no GitHub session could be established; `refresh()` maps it to the panel's status screens. */
export class SessionError extends Error {
  constructor(readonly status: SessionStatus) {
    super(SESSION_MESSAGES[status]);
  }
}

type IssuePatch = { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] };

export class IssuesStore {
  private issues: GithubIssue[] = [];
  private repo: GithubRepoRef | null = null;
  private repoLabels: GithubLabel[] | null = null;
  private assignableUsers: GithubUser[] | null = null;
  private viewerLogin: string | null = null;

  constructor(private readonly getCwd: () => string | null) {}

  /** Seeds in-memory state from a persisted cache, without a network call. */
  hydrateFromCache(repo: GithubRepoRef, issues: GithubIssue[], viewerLogin: string | null): void {
    this.setRepo(repo);
    this.issues = issues;
    this.viewerLogin = viewerLogin;
  }

  /**
   * Resolves the workspace's GitHub repo and a live session token. Every read and write goes through
   * here, so no call can go out with a missing or stale repo/token (#106). `interactive` shows the
   * sign-in prompt, and is used for user-initiated writes; background reads stay silent.
   */
  async ensureSession(interactive: boolean): Promise<{ repo: GithubRepoRef; token: string }> {
    const cwd = this.getCwd();
    if (!cwd) throw new SessionError('no-workspace');
    const repo = getWorkspaceGithubRepo(cwd);
    if (!repo) throw new SessionError('no-remote');
    // VS Code rejects (rather than resolving undefined) when the sign-in prompt is dismissed.
    const session = await getGithubSession(interactive).then(s => s, () => undefined);
    if (!session) throw new SessionError('signed-out');
    this.setRepo(repo);
    this.viewerLogin = session.account.label;
    return { repo, token: session.accessToken };
  }

  /** Switches the active repo, dropping every per-repo cache when it actually changes. */
  private setRepo(repo: GithubRepoRef): void {
    if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
      this.issues = [];
      this.repoLabels = null;
      this.assignableUsers = null;
    }
    this.repo = repo;
  }

  async refresh(state: IssueState): Promise<IssuesResult> {
    try {
      const { repo, token } = await this.ensureSession(false);
      this.issues = await fetchIssues(repo.owner, repo.repo, state, token);
      return { status: 'ok', repo, issues: this.issues, viewerLogin: this.viewerLogin };
    } catch (err) {
      if (err instanceof SessionError) return { status: err.status };
      return { status: 'error', message: (err as Error).message };
    }
  }

  async getRepoLabels(): Promise<GithubLabel[]> {
    const { repo, token } = await this.ensureSession(false);
    if (!this.repoLabels) this.repoLabels = await fetchRepoLabels(repo.owner, repo.repo, token);
    return this.repoLabels;
  }

  async getAssignableUsers(): Promise<GithubUser[]> {
    const { repo, token } = await this.ensureSession(false);
    if (!this.assignableUsers) this.assignableUsers = await fetchAssignableUsers(repo.owner, repo.repo, token);
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

  async getComments(issueNumber: number): Promise<GithubComment[]> {
    const { repo, token } = await this.ensureSession(false);
    return fetchComments(repo.owner, repo.repo, issueNumber, token);
  }

  async getTimeline(issueNumber: number): Promise<GithubTimelineEvent[]> {
    const { repo, token } = await this.ensureSession(false);
    return fetchTimeline(repo.owner, repo.repo, issueNumber, token);
  }

  /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching the whole list. */
  async reloadIssue(issueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(false);
    const fresh = await fetchIssue(repo.owner, repo.repo, issueNumber, token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? fresh : issue));
  }

  async updateIssue(issueNumber: number, patch: IssuePatch): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const updated = await updateIssue(repo.owner, repo.repo, issueNumber, patch, token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? updated : issue));
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.issues = [created, ...this.issues];
    return created;
  }

  async addComment(issueNumber: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    const comment = await createComment(repo.owner, repo.repo, issueNumber, body, token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: issue.comments + 1 } : issue,
    );
    return comment;
  }

  async updateComment(commentId: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    return updateComment(repo.owner, repo.repo, commentId, body, token);
  }

  async deleteComment(issueNumber: number, commentId: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    await deleteComment(repo.owner, repo.repo, commentId, token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: Math.max(0, issue.comments - 1) } : issue,
    );
  }
}
