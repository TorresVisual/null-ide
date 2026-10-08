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

function projectSections(projects: LauncherProject[], query: string, sort: ProjectSort): Array<{ kind: 'pinned' | 'directory'; title: string; projects: LauncherProject[] }> {
  const needle = searchable(query.trim());
  const filtered = projects.filter(project => !needle || searchable(project.label).includes(needle) || searchable(project.path).includes(needle));
  const ordered = [...filtered].sort(compareProjects(sort));
  const pinned = ordered.filter(project => project.pinned);
  const directories = new Map<string, LauncherProject[]>();
  for (const project of ordered.filter(project => !project.pinned)) {
    const directory = projectDirectory(project.path);
    const group = directories.get(directory) ?? [];
    group.push(project);
    directories.set(directory, group);
  }
  return [
    ...(pinned.length ? [{ kind: 'pinned' as const, title: 'Pinned', projects: pinned }] : []),
    ...[...directories].map(([title, groupedProjects]) => ({ kind: 'directory' as const, title, projects: groupedProjects })),
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
