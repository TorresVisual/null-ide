'use strict';

// Webview-side mirrors of the records in src/github/types.ts (this bundle is `module: none`, so it cannot import
// them). The host sends exactly these shapes; keep the two files in sync by hand.

interface GithubLabel { name: string; color: string; description?: string | null; }
interface GithubUser { login: string; avatar_url: string; }
interface IssueTemplate { name: string; title: string; body: string; labels: string[]; }

interface ReactionGroup { content: string; count: number; viewerHasReacted: boolean; }

interface IssuePost {
  id: string; url: string; author: GithubUser; authorAssociation: string | null; createdAt: string;
  lastEditedAt: string | null; bodyHTML: string; body: string; reactions: ReactionGroup[];
  viewerCanUpdate: boolean; viewerCanDelete: boolean; minimizedReason: string | null;
}

type TimelineEventBody =
  | { type: 'labels'; added: GithubLabel[]; removed: GithubLabel[] }
  | { type: 'closed'; reason: 'completed' | 'not_planned' | 'duplicate' | null; closer: { text: string; url: string } | null }
  | { type: 'reopened' }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'assigned' | 'unassigned'; login: string }
  | { type: 'milestoned' | 'demilestoned'; title: string }
  | { type: 'cross-referenced' | 'connected' | 'referenced' | 'sub-issue-added' | 'sub-issue-removed'; text: string; url: string };
type TimelineEvent = { kind: 'event'; at: string; actor: string } & TimelineEventBody;
type TimelineItem = ({ kind: 'comment' } & IssuePost) | TimelineEvent;

interface SubIssue {
  id: string; number: number; title: string; state: 'open' | 'closed'; stateReason: string | null; url: string;
  assignees: GithubUser[];
}
interface LinkedPr { number: number; title: string; state: 'open' | 'closed' | 'merged'; isDraft: boolean; url: string; }

interface DetailIssue {
  number: number; title: string; body: string; state: 'open' | 'closed'; state_reason?: string | null; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  created_at?: string;
}

interface IssueDetail {
  id: string;
  issue: DetailIssue;
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

/** What the sidebar pickers choose from; arrives separately from `detail` because it is cached per repo. */
interface DetailMetadata {
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestones: Array<{ number: number; title: string }>;
  types: Array<{ id: string; name: string }>;
}
