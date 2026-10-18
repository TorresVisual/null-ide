'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { nullDataDir } from './dataDir';

export interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
  pinned: boolean;
  gitBranch?: string;
  projectType?: string;
  icon?: string;
}

type StoredEntry = Omit<RecentProjectEntry, 'pinned'> & { pinned?: boolean };

export function getRecentProjectsFilePath(): string {
  return path.join(nullDataDir(), 'null-recent-projects.json');
}

// Windows paths are case-insensitive, so 'Work' and 'work' name one project there; Linux paths are not.
export function normalizeRecentProjectPath(value: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readEntry(value: unknown): RecentProjectEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<StoredEntry>;
  if (typeof entry.path !== 'string' || typeof entry.label !== 'string'
    || typeof entry.isWorkspaceFile !== 'boolean' || typeof entry.timestamp !== 'number'
    || !Number.isFinite(entry.timestamp) || (entry.pinned !== undefined && typeof entry.pinned !== 'boolean')) return undefined;
  return {
    path: entry.path, label: entry.label, isWorkspaceFile: entry.isWorkspaceFile,
    timestamp: entry.timestamp, pinned: entry.pinned ?? false,
    ...(typeof entry.gitBranch === 'string' ? { gitBranch: entry.gitBranch } : {}),
    ...(typeof entry.projectType === 'string' ? { projectType: entry.projectType } : {}),
    ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
  };
}

export function readRecentProjects(filePath: string): RecentProjectEntry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(readEntry).filter((entry): entry is RecentProjectEntry => !!entry) : [];
  } catch { return []; }
}

export function writeRecentProjects(filePath: string, entries: RecentProjectEntry[]): boolean {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(entries));
    fs.renameSync(temporaryFile, filePath);
    return true;
  } catch {
    try { fs.unlinkSync(temporaryFile); } catch { /* best effort cleanup */ }
    return false;
  }
}

function retain(entries: RecentProjectEntry[], maxItems: number): RecentProjectEntry[] {
  const unique = new Map<string, RecentProjectEntry>();
  for (const entry of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
    const key = normalizeRecentProjectPath(entry.path);
    if (!unique.has(key)) unique.set(key, entry);
  }
  const sorted = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp);
  const maxUnpinned = Number.isFinite(maxItems) ? Math.max(1, Math.floor(maxItems)) : 1;
  let unpinned = 0;
  return sorted.filter(entry => entry.pinned || ++unpinned <= maxUnpinned);
}

export function updateRecentProjects(filePath: string, mutate: (entries: RecentProjectEntry[]) => RecentProjectEntry[], maxItems: number): boolean {
  try {
    const updated = mutate(readRecentProjects(filePath).map(entry => ({ ...entry })));
    return Array.isArray(updated) && writeRecentProjects(filePath, retain(updated, maxItems));
  } catch { return false; }
}

export function touchRecentProject(filePath: string, entry: Omit<RecentProjectEntry, 'timestamp'>, maxItems: number): boolean {
  return updateRecentProjects(filePath, entries => {
    const key = normalizeRecentProjectPath(entry.path);
    const previous = entries.find(candidate => normalizeRecentProjectPath(candidate.path) === key);
    return [{ ...previous, ...entry, timestamp: Date.now(), pinned: previous?.pinned ?? entry.pinned }, ...entries.filter(candidate => normalizeRecentProjectPath(candidate.path) !== key)];
  }, maxItems);
}

export function setRecentProjectPinned(filePath: string, requestedPath: string, pinned: boolean, maxItems: number): boolean {
  const key = normalizeRecentProjectPath(requestedPath);
  return updateRecentProjects(filePath, entries => entries.map(entry => normalizeRecentProjectPath(entry.path) === key ? { ...entry, pinned } : entry), maxItems);
}

export function removeRecentProject(filePath: string, requestedPath: string, maxItems: number): boolean {
  const key = normalizeRecentProjectPath(requestedPath);
  return updateRecentProjects(filePath, entries => entries.filter(entry => normalizeRecentProjectPath(entry.path) !== key), maxItems);
}

export function replaceRecentProjectPath(filePath: string, requestedPath: string, replacementPath: string, replacementLabel: string, maxItems: number): boolean {
  const key = normalizeRecentProjectPath(requestedPath);
  return updateRecentProjects(filePath, entries => entries.map(entry => normalizeRecentProjectPath(entry.path) === key
    ? { ...entry, path: replacementPath, label: replacementLabel } : entry), maxItems);
}

/** The stored entry for `requestedPath`, read fresh from disk. Undefined if it was removed or replaced. */
export function findCurrentRecentProject(filePath: string, requestedPath: string): RecentProjectEntry | undefined {
  const key = normalizeRecentProjectPath(requestedPath);
  return readRecentProjects(filePath).find(entry => normalizeRecentProjectPath(entry.path) === key);
}

/** Points an existing entry at a directory the user chose. Refuses anything that is not a directory. */
export function relocateRecentProject(filePath: string, requestedPath: string, replacementPath: string, maxItems: number): boolean {
  try {
    if (!fs.statSync(replacementPath).isDirectory()) { return false; }
  } catch {
    return false;
  }
  const label = path.basename(replacementPath) || replacementPath;
  return replaceRecentProjectPath(filePath, requestedPath, replacementPath, label, maxItems);
}
