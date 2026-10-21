'use strict';

import { CheckState, checkStateOf, REVIEWS } from '../pulls/pullModel';
import { IssueRow, PrRow } from './widgetTypes';

export const WIDGET_QUERY = `
query WidgetItems($assigned: String!, $mentioned: String!, $authored: String!, $reviewReq: String!, $n: Int!) {
  assigned: search(query: $assigned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  mentioned: search(query: $mentioned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  authored: search(query: $authored, type: ISSUE, first: $n) { nodes { ...PrFields } }
  reviewReq: search(query: $reviewReq, type: ISSUE, first: $n) { nodes { ...PrFields } }
}
fragment IssueFields on Issue {
  number title url updatedAt repository { nameWithOwner }
  labels(first: 5) { nodes { name } } assignees(first: 1) { nodes { login } }
}
fragment PrFields on PullRequest {
  number title url updatedAt isDraft mergeable reviewDecision repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export interface SearchStrings { assigned: string; mentioned: string; authored: string; reviewReq: string }

export function searchStrings(repos: string[]): SearchStrings {
  const scope = repos.map(r => `repo:${r}`).join(' ');
  const q = (rest: string): string => `${scope} ${rest} sort:updated-desc`;
  return {
    assigned: q('is:issue is:open assignee:@me'),
    mentioned: q('is:issue is:open mentions:@me'),
    authored: q('is:pr is:open author:@me'),
    reviewReq: q('is:pr is:open review-requested:@me'),
  };
}

/** GitHub rejects search queries over 256 characters; the longest suffix above is under 50, so the `repo:` scope gets 150. */
export function chunkRepos(repos: string[], maxScopeChars = 150): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [], len = 0;
  for (const r of repos) {
    const add = r.length + 6;                                   // "repo:" + space
    if (cur.length && len + add > maxScopeChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(r); len += add;
  }
  if (cur.length) { chunks.push(cur); }
  return chunks;
}

export type LocalPaths = ReadonlyMap<string, string>;
interface Nodes { nodes: Array<Record<string, unknown>> }
export interface WidgetData { assigned: Nodes; mentioned: Nodes; authored: Nodes; reviewReq: Nodes }

interface GqlIssue { number: number; title: string; url: string; updatedAt: string; repository: { nameWithOwner: string };
  labels: { nodes: Array<{ name: string }> }; assignees: { nodes: Array<{ login: string }> } }
interface GqlPr { number: number; title: string; url: string; updatedAt: string; isDraft: boolean; mergeable: string; reviewDecision: string | null;
  repository: { nameWithOwner: string }; author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> } }

const isNode = (n: Record<string, unknown>): boolean => typeof n.number === 'number';
const CHECKS: Record<CheckState, PrRow['checks']> = { success: 'passing', failure: 'failing', pending: 'pending', none: 'none' };

export function mapIssues(data: WidgetData, local: LocalPaths): IssueRow[] {
  const out = new Map<string, IssueRow>();
  const add = (nodes: Nodes['nodes'], attention: IssueRow['attention']): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlIssue;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key)) { continue; }
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, state: 'open',
        labels: n.labels.nodes.map(l => l.name), assignee: n.assignees.nodes[0]?.login ?? null, attention,
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.assigned.nodes, 'assigned');
  add(data.mentioned.nodes, 'mentioned');
  return [...out.values()];
}

export function mapPrs(data: WidgetData, local: LocalPaths): PrRow[] {
  const requested = new Set<string>();
  for (const raw of data.reviewReq.nodes) {
    if (!isNode(raw)) { continue; }
    const n = raw as unknown as GqlPr;
    if (!n.isDraft) { requested.add(`${n.repository.nameWithOwner.toLowerCase()}#${n.number}`); }   // others' drafts are not asked of anyone yet
  }
  const out = new Map<string, PrRow>();
  const add = (nodes: Nodes['nodes'], ownSet: boolean): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlPr;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key) || (!ownSet && n.isDraft)) { continue; }
      const decision = REVIEWS[n.reviewDecision ?? ''] ?? 'none';
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, author: n.author?.login ?? 'ghost',
        review: requested.has(key) ? 'requested' : decision === 'required' ? 'none' : decision,
        checks: CHECKS[checkStateOf(n.commits.nodes[0]?.commit.statusCheckRollup?.state)], conflict: n.mergeable === 'CONFLICTING',
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.authored.nodes, true);
  add(data.reviewReq.nodes, false);
  return [...out.values()];
}

const newest = (a: { updatedAt: string }, b: { updatedAt: string }): number => b.updatedAt.localeCompare(a.updatedAt);

export function rankIssues(rows: IssueRow[]): IssueRow[] {
  const w = (r: IssueRow): number => (r.attention === 'assigned' ? 0 : 1);
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}

export function rankPrs(rows: PrRow[]): PrRow[] {
  const w = (r: PrRow): number => r.review === 'requested' ? 0 : r.review === 'changes' ? 1 : r.checks === 'failing' ? 2 : r.conflict ? 3 : 4;
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}
