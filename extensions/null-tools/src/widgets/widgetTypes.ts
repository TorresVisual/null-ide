'use strict';

export const SCHEMA = 1;
export const MAX_PROJECTS = 8, MAX_ISSUES = 10, MAX_PRS = 10;
export type Reason = 'signed_out' | 'offline' | 'error';
export type Status = 'ok' | Reason;
export interface Failed { repo: string; reason: Reason }
export interface Section<T> { status: Status; failed: Failed[]; items: T[] }
export interface ProjectRow { name: string; path: string; branch: string | null; dirty: boolean; pinned: boolean; lastOpened: string | null }
export interface IssueRow { provider: 'github'; repo: string; number: number; title: string; url: string; state: 'open'; labels: string[]; assignee: string | null; attention: 'assigned' | 'mentioned'; localPath: string | null; updatedAt: string }
export interface PrRow { provider: 'github'; repo: string; number: number; title: string; url: string; author: string; review: 'requested' | 'approved' | 'changes' | 'none'; checks: 'passing' | 'failing' | 'pending' | 'none'; conflict: boolean; localPath: string | null; updatedAt: string }
export interface Snapshot { schema: 1; writtenAt: string; projects: Section<ProjectRow>; issues: Section<IssueRow>; prs: Section<PrRow> }
export interface WidgetRepo { repo: string; account: string }

// Owners never contain a dot and a repo is never just dots, so `../x` and `./x` cannot pass.
export const REPO_RE = /^[A-Za-z0-9_-]{1,100}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

/** The only gate between a settings value and a GitHub search string. */
export function parseRepos(raw: unknown): WidgetRepo[] {
  if (!Array.isArray(raw)) { return []; }
  const seen = new Set<string>();
  const out: WidgetRepo[] = [];
  for (const e of raw) {
    const repo = (e as WidgetRepo | null)?.repo, account = (e as WidgetRepo | null)?.account;
    if (typeof repo !== 'string' || typeof account !== 'string' || !account || !REPO_RE.test(repo)) { continue; }
    const key = `${account}\n${repo.toLowerCase()}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push({ repo, account });
  }
  return out;
}
