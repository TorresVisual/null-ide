'use strict';

interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
  pinned: boolean;
  gitBranch?: string;
  projectType?: string;
  icon?: string;
}

interface GitStatus { branch: string; dirty: boolean; }

interface LauncherProject extends RecentProjectEntry {
  available: boolean;
  gitStatus: GitStatus | null;
}

type ProjectSort = 'lastOpened' | 'name' | 'location';

function searchable(value: string): string {
  return value.replace(/[\\/]+/g, '/').toLowerCase();
}

function projectDirectory(value: string): string {
  const lastSeparator = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  return lastSeparator >= 0 ? value.slice(0, lastSeparator) : value;
}

function compareProjects(sort: ProjectSort): (left: LauncherProject, right: LauncherProject) => number {
  if (sort === 'name') return (left, right) => left.label.localeCompare(right.label) || left.timestamp - right.timestamp;
  if (sort === 'location') return (left, right) => projectDirectory(left.path).localeCompare(projectDirectory(right.path)) || left.label.localeCompare(right.label);
  return (left, right) => right.timestamp - left.timestamp;
}

type ProjectSection = { kind: 'pinned' | 'recent' | 'directory'; title: string; projects: LauncherProject[] };

function recencyTitle(timestamp: number, now: number): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - day) return 'Yesterday';
  if (timestamp >= startOfToday - 6 * day) return 'This week';
  return 'Earlier';
}

function projectSections(projects: LauncherProject[], query: string, sort: ProjectSort, now = Date.now()): ProjectSection[] {
  const needle = searchable(query.trim());
  const filtered = projects.filter(project => !needle || searchable(project.label).includes(needle) || searchable(project.path).includes(needle));
  const ordered = [...filtered].sort(compareProjects(sort));
  const pinned = ordered.filter(project => project.pinned);
  const rest = ordered.filter(project => !project.pinned);
  const groups = new Map<string, LauncherProject[]>();
  const kind = sort === 'location' ? 'directory' : 'recent';
  for (const project of rest) {
    const title = sort === 'location' ? projectDirectory(project.path) : sort === 'name' ? 'Projects' : recencyTitle(project.timestamp, now);
    const group = groups.get(title) ?? [];
    group.push(project);
    groups.set(title, group);
  }
  return [
    ...(pinned.length ? [{ kind: 'pinned' as const, title: 'Pinned', projects: pinned }] : []),
    ...[...groups].map(([title, groupedProjects]) => ({ kind: kind as 'recent' | 'directory', title, projects: groupedProjects })),
  ];
}

function relativeProjectTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Row-sized age: "now", "5m", "3h", "2d", "6w". */
function shortProjectTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/** "3h 12m", "45m", "0m". */
function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
