'use strict';

export type IssueState = 'open' | 'closed' | 'all';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubLabel {
  name: string;
  color: string;
  /** Only present on labels from the repo metadata query. */
  description?: string | null;
}

export interface GithubUser {
  login: string;
  avatar_url: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  /** Why a closed issue was closed; null while open or for issues closed before GitHub tracked reasons. */
  state_reason?: 'completed' | 'not_planned' | 'reopened' | 'duplicate' | null;
  html_url: string;
  labels: GithubLabel[];
  assignees: GithubUser[];
  user: GithubUser;
  comments: number;
  /** The fields below come from the GraphQL list query; REST-fetched issues lack them. */
  created_at?: string;
  updated_at: string;
  closed_at?: string | null;
  milestone?: { number: number; title: string } | null;
  issue_type?: string | null;
  sub_issues?: { total: number; completed: number } | null;
  linked_prs?: number;
  pull_request?: unknown;
  /** REST responses only (create/update). GraphQL-mapped issues don't carry it; the detail query has its own `id`. */
  node_id?: string;
  /** True when an unpushed local commit will close this issue on push. Computed client-side, never sent to GitHub. */
  closedLocally?: boolean;
}

export interface IssueTemplate {
  name: string;
  about: string;
  title: string;
  body: string;
  labels: string[];
}

export interface RepoMetadata {
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestones: Array<{ number: number; title: string }>;
  issueTypes: Array<{ id: string; name: string }>;
  viewerLogin: string;
}

export interface SearchPage {
  items: GithubIssue[];
  hasMore: boolean;
  cursor: string | null;
  /** Null when the request skipped the count aliases (every page after the first). */
  openCount: number | null;
  closedCount: number | null;
}

export type ReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';

export interface ReactionGroup {
  content: ReactionContent;
  count: number;
  viewerHasReacted: boolean;
}

/** The issue body or one comment, as the detail tab shows it. `id` is the GraphQL node ID: reaction subject and edit/delete target. */
export interface IssuePost {
  id: string;
  url: string;
  author: GithubUser;
  /** GitHub's `authorAssociation` ("OWNER", "MEMBER", "NONE", ...); null on mutation payloads that omit it. */
  authorAssociation: string | null;
  createdAt: string;
  lastEditedAt: string | null;
  /** Server-rendered HTML; the webview sanitizes it again before inserting. */
  bodyHTML: string;
  /** Markdown source, for editing and quote reply. */
  body: string;
  reactions: ReactionGroup[];
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  /** Why a moderator collapsed this comment ("off-topic", "outdated", ...); null when it is shown normally. */
  minimizedReason: string | null;
}

/** What happened, without who/when. Split from `TimelineEvent` so mappers can build the body on its own. */
export type TimelineEventBody =
  | { type: 'labels'; added: GithubLabel[]; removed: GithubLabel[] }
  | { type: 'closed'; reason: 'completed' | 'not_planned' | 'duplicate' | null; closer: { text: string; url: string } | null }
  | { type: 'reopened' }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'assigned' | 'unassigned'; login: string }
  | { type: 'milestoned' | 'demilestoned'; title: string }
  | { type: 'cross-referenced' | 'connected' | 'referenced' | 'sub-issue-added' | 'sub-issue-removed'; text: string; url: string };

/** One line on the timeline rail. `actor` is a login ("ghost" for deleted accounts). */
export type TimelineEvent = { kind: 'event'; at: string; actor: string } & TimelineEventBody;

export type TimelineItem = ({ kind: 'comment' } & IssuePost) | TimelineEvent;

export interface SubIssue {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  url: string;
  assignees: GithubUser[];
}

export interface LinkedPr {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  url: string;
  /** Login ("ghost" for deleted accounts). */
  author: string;
  /** `#12` inside this repo, `owner/other#12` elsewhere. */
  ref: string;
}

/** Everything the detail tab shows for one issue. `issue` is the same REST-shaped record the lists use. */
export interface IssueDetail {
  id: string;
  issue: GithubIssue;
  post: IssuePost;
  issueType: { id: string; name: string } | null;
  milestone: { number: number; title: string; percent: number } | null;
  parent: { number: number; title: string; url: string } | null;
  subIssues: SubIssue[];
  linkedPrs: LinkedPr[];
  participants: GithubUser[];
  timeline: TimelineItem[];
  hasMoreTimeline: boolean;
  timelineCursor: string | null;
}

export interface TimelinePage {
  items: TimelineItem[];
  hasMore: boolean;
  cursor: string | null;
}
