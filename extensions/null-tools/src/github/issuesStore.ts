'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import { CreateExtraStep, runCreateExtras } from './createExtras';
import { IssuePatch, createIssue, renderMarkdown, requestGraphql, updateIssue } from './githubApi';
import { resolveImage } from './imageCache';
import { uploadImage } from './imageUpload';
import {
  ADD_COMMENT, ADD_REACTION, ADD_SUB_ISSUE, DELETE_COMMENT, GqlComment, GqlReactionGroup, ISSUE_DETAIL, ISSUE_TIMELINE,
  IssueDetailData, IssueTimelineData, REMOVE_REACTION, REMOVE_SUB_ISSUE, SET_ISSUE_TYPE, UPDATE_COMMENT, mapComment,
  mapIssueDetail, mapReactions, mapTimelinePage,
} from './detailQueries';
import {
  ISSUE_COUNTS, IssueCountsData, MetadataData, REPO_METADATA, SEARCH_ISSUES, SearchData, mapMetadata, mapSearchPage,
} from './githubQueries';
import { IssueSuggestion, matchIssues, toSuggestion } from './issueSuggest';
import { toApiQuery, withState } from './searchQuery';
import {
  GithubIssue, GithubRepoRef, IssueDetail, IssuePost,
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
  private metadata: RepoMetadata | null = null;
  private viewerLogin: string | null = null;

  private readonly listeners = new Set<() => void>();

  constructor(private readonly getCwd: () => string | null) {}

  /** Fires after anything that can move the issue counts: a fresh first page, a create, a state/assignee edit. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void {
    this.listeners.forEach(l => l());
  }

  /** Open issues in the workspace repo and how many are assigned to the viewer: exact search totals, not a page length. */
  async getOpenCounts(): Promise<{ repo: GithubRepoRef; open: number; mine: number }> {
    const { repo, token } = await this.ensureSession(false);
    const name = `${repo.owner}/${repo.repo}`;
    const data = await requestGraphql<IssueCountsData>(ISSUE_COUNTS, {
      open: toApiQuery(name, 'is:open'),
      mine: toApiQuery(name, 'is:open assignee:@me'),
    }, token);
    return { repo, open: data.open.issueCount, mine: data.mine.issueCount };
  }

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
    this.viewerLogin = session.login;
    return { repo, token: session.accessToken };
  }

  /** Switches the active repo, dropping every per-repo cache when it actually changes. */
  private setRepo(repo: GithubRepoRef): void {
    if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
      this.known.clear();
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
    if (withCounts) this.changed();
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

  /**
   * The issue body and every visible comment, paging past the first 100 timeline items, for Copy as prompt.
   * Collapsed (minimized) comments are spam or off-topic, so they stay out.
   * ponytail: 1000 timeline items at most; a longer thread is cut off there.
   */
  async getConversation(issueNumber: number): Promise<{ post: IssuePost; comments: IssuePost[] }> {
    const detail = await this.getDetail(issueNumber);
    const items = [...detail.timeline];
    let cursor = detail.hasMoreTimeline ? detail.timelineCursor : null;
    for (let pages = 0; cursor && pages < 9; pages++) {
      const page = await this.getTimelinePage(issueNumber, cursor);
      items.push(...page.items);
      cursor = page.hasMore ? page.cursor : null;
    }
    const comments = items.filter((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment' && !i.minimizedReason);
    return { post: detail.post, comments };
  }

  /** GitHub's own rendering of `text` in this repo's context (so `#12` and `@user` become links), for the composer's Preview tab. */
  async renderPreview(text: string): Promise<string> {
    const { repo, token } = await this.ensureSession(false);
    return renderMarkdown(text, `${repo.owner}/${repo.repo}`, token);
  }

  /** Local file for an image shown in a post or the preview; downloads it once into `.null/issue-images`. */
  async resolveImage(url: string): Promise<string> {
    const { token } = await this.ensureSession(false);
    return resolveImage(url, { root: this.getCwd()!, token }); // ensureSession succeeded, so there is a workspace folder
  }

  /** Commits an image to the repo's `null-issue-assets` branch and returns the markdown that links it. Prompts for sign-in like every write. */
  async uploadImage(name: string, mime: string, bytes: Buffer): Promise<string> {
    const { repo, token } = await this.ensureSession(true);
    return uploadImage(repo, token, { name, mime, bytes });
  }

  /** Issues for the composer's `#` popup: what is already loaded first, then (from 2 characters) a server search. */
  async suggestIssues(prefix: string): Promise<IssueSuggestion[]> {
    const local = matchIssues([...this.known.values()], prefix);
    if (prefix.length < 2 || local.length >= 5) return local;
    try {
      const page = await this.search(prefix, null, false);
      const have = new Set(local.map(i => i.number));
      return local.concat(page.items.filter(i => !have.has(i.number)).map(toSuggestion)).slice(0, 8);
    } catch {
      return local; // offline or rate limited: the loaded issues are still a useful answer
    }
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

  async updateIssue(issueNumber: number, patch: IssuePatch): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const updated = await updateIssue(repo.owner, repo.repo, issueNumber, patch, token);
    this.remember([updated]);
    this.changed();
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[]; milestone?: number },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.remember([created]);
    this.changed();
    return created;
  }

  /**
   * REST create can't set an issue type or a parent, so they follow it. Returns what failed and never throws.
   * ponytail: the parent's node id comes from a full getDetail (100 timeline items); add a light id query if that is ever slow.
   */
  applyCreateExtras(created: GithubIssue, extras: { typeId: string | null; parent: number | null }): Promise<string[]> {
    const steps: CreateExtraStep[] = [];
    const { typeId, parent } = extras;
    if (typeId) {
      steps.push({
        what: 'set the type',
        run: async () => {
          if (!created.node_id) throw new Error('GitHub did not return the issue id');
          await this.setIssueType(created.node_id, typeId);
        },
      });
    }
    if (parent) {
      steps.push({
        what: `link it to #${parent}`,
        run: async () => this.addSubIssue((await this.getDetail(parent)).id, created.number),
      });
    }
    return runCreateExtras(steps);
  }
}
