'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
}

export const MAX_TRACKED_ENTRIES = 50;

export function getRecentProjectsFilePath(): string {
  const appData = process.env.APPDATA;
  if (!appData) { throw new Error('Cannot locate %APPDATA%.'); }
  return path.join(appData, 'Null', 'null-recent-projects.json');
}

export function readRecentProjects(filePath: string): RecentProjectEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecentProjectsAtomic(filePath: string, entries: RecentProjectEntry[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, '\t'));
  fs.renameSync(tmpPath, filePath);
}

export function upsertEntry(
  entries: RecentProjectEntry[],
  entry: Pick<RecentProjectEntry, 'path' | 'label' | 'isWorkspaceFile'>,
  maxEntries: number = MAX_TRACKED_ENTRIES,
): RecentProjectEntry[] {
  const normalizedTarget = entry.path.toLowerCase();
  const withoutExisting = entries.filter(e => e.path.toLowerCase() !== normalizedTarget);
  const updated: RecentProjectEntry[] = [
    { path: entry.path, label: entry.label, isWorkspaceFile: entry.isWorkspaceFile, timestamp: Date.now() },
    ...withoutExisting,
  ];
  return updated.slice(0, maxEntries);
}
