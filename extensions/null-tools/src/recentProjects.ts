'use strict';

import * as fs from 'fs';
import * as path from 'path';

// Written by the VS Code main process (patches/001-jumplist-recent-projects.patch),
// directly inside addRecentlyOpened(), not by this extension. This module only
// reads the file, for the "More Recent Projects..." quick-pick.

export interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
}

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
