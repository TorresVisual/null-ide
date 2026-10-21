'use strict';

import type { GitStatus } from '../dashboardGitStatus';
import type { RecentProjectEntry } from '../recentProjects';
import { Failed, MAX_PROJECTS, ProjectRow, Reason, Section } from './widgetTypes';

export interface RepoOutcome<T> { repo: string; rows: T[] | null; reason?: Reason }

export function buildSection<T>(
  outcomes: RepoOutcome<T>[], previous: ReadonlyMap<string, T[]>, rank: (rows: T[]) => T[], max: number,
): { section: Section<T>; kept: Map<string, T[]> } {
  const kept = new Map<string, T[]>();
  const failed: Failed[] = [];
  for (const o of outcomes) {
    const key = o.repo.toLowerCase();
    if (o.rows) { kept.set(key, o.rows); continue; }
    kept.set(key, previous.get(key) ?? []);                               // keep the last good rows
    failed.push({ repo: o.repo, reason: o.reason ?? 'error' });
  }
  const items = rank([...kept.values()].flat()).slice(0, max);
  let status: Section<T>['status'] = 'ok';
  if (outcomes.length > 0 && failed.length === outcomes.length) {
    const reasons = new Set(failed.map(f => f.reason));
    status = reasons.size === 1 ? failed[0].reason : 'error';
  }
  return { section: { status, failed, items }, kept };
}

export function buildProjects(entries: RecentProjectEntry[], statuses: ReadonlyMap<string, GitStatus | null>): Section<ProjectRow> {
  const ordered = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp).slice(0, MAX_PROJECTS);
  const items = ordered.map((e): ProjectRow => {
    const git = statuses.get(e.path) ?? null;
    return { name: e.label, path: e.path, branch: git?.branch ?? null, dirty: git?.dirty ?? false, pinned: e.pinned, lastOpened: new Date(e.timestamp).toISOString() };
  });
  return { status: 'ok', failed: [], items };
}
