'use strict';

// Webview-side mirror of PullPage in src/pulls/pullDetailModel.ts (this bundle is `module: none`, so it cannot
// import it). The host sends exactly these shapes; keep the two files in sync by hand.

interface PullUser { login: string; avatar: string; }
type PullVerdict = 'approved' | 'changes' | 'commented' | 'dismissed';
interface PullReviewer { login: string; avatar: string; state: PullVerdict | 'pending'; }
type PullCheckState = 'success' | 'failure' | 'pending' | 'neutral';
interface PullCheck { name: string; state: PullCheckState; url: string | null; runId: number | null; description: string; }
interface PullCommit { sha: string; short: string; headline: string; author: string; at: string; url: string; }
type PullTimelineEntry =
  | { kind: 'comment'; author: PullUser; at: string; bodyHTML: string; url: string }
  | { kind: 'review'; author: PullUser; at: string; verdict: PullVerdict; bodyHTML: string; url: string; comments: number }
  | { kind: 'event'; at: string; actor: string; event: 'closed' | 'merged' | 'reopened' | 'ready' | 'draft' };

interface PullPage {
  number: number; title: string; url: string; state: 'open' | 'closed' | 'merged'; draft: boolean;
  author: PullUser; createdAt: string; bodyHTML: string;
  headRef: string; baseRef: string; fork: boolean;
  additions: number; deletions: number; changedFiles: number;
  labels: Array<{ name: string; color: string }>;
  milestone: string | null;
  assignees: PullUser[];
  reviewers: PullReviewer[];
  commits: PullCommit[]; commitTotal: number;
  timeline: PullTimelineEntry[]; timelineTotal: number;
  checkState: 'success' | 'failure' | 'pending' | 'none'; checks: PullCheck[]; checksTotal: number;
}
