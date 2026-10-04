'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import {
  IssuePatch, createComment, createIssue, deleteComment, fetchAssignableUsers, fetchComments, fetchIssue, fetchRepoLabels,
  fetchTimeline, requestGraphql, updateComment, updateIssue,
} from './githubApi';
import {
  ADD_COMMENT, ADD_REACTION, ADD_SUB_ISSUE, DELETE_COMMENT, GqlComment, GqlReactionGroup, ISSUE_DETAIL, ISSUE_TIMELINE,
  IssueDetailData, IssueTimelineData, REMOVE_REACTION, REMOVE_SUB_ISSUE, SET_ISSUE_TYPE, UPDATE_COMMENT, mapComment,
  mapIssueDetail, mapReactions, mapTimelinePage,
} from './detailQueries';
import { MetadataData, REPO_METADATA, SEARCH_ISSUES, SearchData, mapMetadata, mapSearchPage } from './githubQueries';
import { toApiQuery, withState } from './searchQuery';
import {
  GithubComment, GithubIssue, GithubLabel, GithubRepoRef, GithubTimelineEvent, GithubUser, IssueDetail, IssuePost,
  ReactionContent, ReactionGroup, RepoMetadata, SearchPage, TimelinePage,
} from './types';

export const PAGE_SIZE = 50;

type SessionStatus = 'no-workspace' | 'no-remote' | 'signed-out';

const SESSION_MESSAGES: Record<SessionStatus, string> = {
  'no-workspace': 'Open a folder to use GitHub issues.',
  'no-remote': 'This folder has no GitHub remote.',
  'signed-out': 'Sign in to GitHub to continue.',
};

/** Why no GitHub session could be established; the list controller maps it to the panel's status screens. */
export class SessionError extends Error {
  constructor(readonly status: SessionStatus) {
    super(SESSION_MESSAGES[status]);
  }
}

export class IssuesStore {
  /** Every issue any list has loaded, by number, so row actions and the detail tab can find one by number. */
  private known = new Map<number, GithubIssue>();
  private repo: GithubRepoRef | null = null;
  private repoLabels: GithubLabel[] | null = null;
  private assignableUsers: GithubUser[] | null = null;
  private metadata: RepoMetadata | null = null;
  private viewerLogin: string | null = null;

  constructor(private readonly getCwd: () => string | null) {}

  /** Seeds in-memory state from a persisted cache, without a network call. */
  hydrateFromCache(repo: GithubRepoRef, issues: GithubIssue[]): void {
    this.setRepo(repo);
    this.remember(issues);
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
      this.known.clear();
      this.repoLabels = null;
      this.assignableUsers = null;
      this.metadata = null;
    }
    this.repo = repo;
  }

  private remember(issues: GithubIssue[]): void {
    for (const issue of issues) this.known.set(issue.number, issue);
  }

  /** One page of a search. `withCounts` also fetches the Open/Closed tab counts (first page only). */
  async search(query: string, cursor: string | null, withCounts: boolean): Promise<SearchPage> {
    const { repo, token } = await this.ensureSession(false);
    const name = `${repo.owner}/${repo.repo}`;
    const data = await requestGraphql<SearchData>(SEARCH_ISSUES, {
      q: toApiQuery(name, query),
      qOpen: toApiQuery(name, withState(query, 'open')),
      qClosed: toApiQuery(name, withState(query, 'closed')),
      first: PAGE_SIZE,
      after: cursor,
      withCounts,
    }, token);
    const page = mapSearchPage(data);
    this.remember(page.items);
    return page;
  }

  /** Labels, assignable users, milestones and issue types for the filter dropdowns. Cached until `force`. */
  async getMetadata(force = false): Promise<RepoMetadata> {
    const { repo, token } = await this.ensureSession(false);
    if (force || !this.metadata) {
      this.metadata = mapMetadata(await requestGraphql<MetadataData>(
        REPO_METADATA, { owner: repo.owner, name: repo.repo }, token));
    }
    return this.metadata;
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

  /** One issue with its first timeline page. Also refreshes the by-number cache the row actions read. */
  async getDetail(issueNumber: number): Promise<IssueDetail> {
    const { repo, token } = await this.ensureSession(false);
    const data = await requestGraphql<IssueDetailData>(
      ISSUE_DETAIL, { owner: repo.owner, name: repo.repo, number: issueNumber }, token);
    const detail = mapIssueDetail(data, `${repo.owner}/${repo.repo}`);
    this.remember([detail.issue]);
    return detail;
  }

  async getTimelinePage(issueNumber: number, after: string): Promise<TimelinePage> {
    const { repo, token } = await this.ensureSession(false);
    const data = await requestGraphql<IssueTimelineData>(
      ISSUE_TIMELINE, { owner: repo.owner, name: repo.repo, number: issueNumber, after }, token);
    if (!data.repository.issue) throw new Error('Issue not found.');
    return mapTimelinePage(data.repository.issue.timelineItems, `${repo.owner}/${repo.repo}`);
  }

  /** A GraphQL write. Prompts for sign-in like every user-initiated write. */
  private async mutate<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const { token } = await this.ensureSession(true);
    return requestGraphql<T>(query, variables, token);
  }

  async toggleReaction(subjectId: string, content: ReactionContent, add: boolean): Promise<ReactionGroup[]> {
    type Payload = { subject: { reactionGroups: GqlReactionGroup[] } };
    const data = await this.mutate<{ addReaction?: Payload; removeReaction?: Payload }>(
      add ? ADD_REACTION : REMOVE_REACTION, { id: subjectId, content });
    return mapReactions((data.addReaction ?? data.removeReaction)!.subject.reactionGroups);
  }

  async setIssueType(issueId: string, typeId: string | null): Promise<void> {
    await this.mutate(SET_ISSUE_TYPE, { id: issueId, typeId });
  }

  async addSubIssue(parentId: string, subIssueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    const url = `https://github.com/${repo.owner}/${repo.repo}/issues/${subIssueNumber}`;
    await requestGraphql(ADD_SUB_ISSUE, { id: parentId, url }, token);
  }

  async removeSubIssue(parentId: string, subIssueId: string): Promise<void> {
    await this.mutate(REMOVE_SUB_ISSUE, { id: parentId, subId: subIssueId });
  }

  /** Posts a comment and returns it already rendered, so the tab can append it without refetching. */
  async postComment(issueNumber: number, issueId: string, body: string): Promise<IssuePost> {
    const data = await this.mutate<{ addComment: { commentEdge: { node: GqlComment } } }>(
      ADD_COMMENT, { id: issueId, body });
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
    return mapComment(data.addComment.commentEdge.node);
  }

  async editComment(commentId: string, body: string): Promise<IssuePost> {
    const data = await this.mutate<{ updateIssueComment: { issueComment: GqlComment } }>(
      UPDATE_COMMENT, { id: commentId, body });
    return mapComment(data.updateIssueComment.issueComment);
  }

  async removeComment(issueNumber: number, commentId: string): Promise<void> {
    await this.mutate(DELETE_COMMENT, { id: commentId });
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.known.get(number);
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

  /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching any list. */
  async reloadIssue(issueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(false);
    this.remember([await fetchIssue(repo.owner, repo.repo, issueNumber, token)]);
  }

  async updateIssue(issueNumber: number, patch: IssuePatch): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const updated = await updateIssue(repo.owner, repo.repo, issueNumber, patch, token);
    this.remember([updated]);
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.remember([created]);
    return created;
  }

  async addComment(issueNumber: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    const comment = await createComment(repo.owner, repo.repo, issueNumber, body, token);
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
    return comment;
  }

  async updateComment(commentId: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    return updateComment(repo.owner, repo.repo, commentId, body, token);
  }

  async deleteComment(issueNumber: number, commentId: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    await deleteComment(repo.owner, repo.repo, commentId, token);
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
  }
}
