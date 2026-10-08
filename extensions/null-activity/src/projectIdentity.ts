'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { ResolvedProject } from './types';

export const NO_FOLDER = '(no folder)';

/** `git@host:Owner/Repo.git`, `https://user:tok@host/owner/repo` and friends all map to `host/owner/repo`. */
export function normalizeRemote(url: string): string {
  let u = url.trim();
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    u = `${scp[1]}/${scp[2]}`;
  } else {
    u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]+@/, '');
  }
  return u.replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function normalizePath(folder: string): string {
  const p = path.resolve(folder).replace(/\\/g, '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function findGitDirs(start: string): { gitDir: string; commonDir: string } | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, '.git');
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) return { gitDir: dotGit, commonDir: dotGit };
    if (stat?.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '');
      if (m) {
        const gitDir = path.resolve(dir, m[1].trim());
        const common = readText(path.join(gitDir, 'commondir'))?.trim();
        return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir };
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function remoteUrl(config: string): string | undefined {
  const urls = new Map<string, string>();
  let section: string | undefined;
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[remote "([^"]+)"\]/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      section = undefined;
      continue;
    }
    const url = section && !urls.has(section) ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (section && url) urls.set(section, url[1]);
  }
  return urls.get('origin') ?? urls.values().next().value;
}

/** Called when the tracker opens an interval, never per heartbeat. */
export function resolveProject(folder: string | undefined): ResolvedProject {
  if (!folder) return { key: NO_FOLDER, name: NO_FOLDER };
  const name = path.basename(folder) || folder;
  const git = findGitDirs(folder);
  const remote = git ? remoteUrl(readText(path.join(git.commonDir, 'config')) ?? '') : undefined;
  const branch = git ? /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(path.join(git.gitDir, 'HEAD')) ?? '')?.[1] : undefined;
  return {
    key: remote ? normalizeRemote(remote) : normalizePath(folder),
    name,
    ...(branch ? { branch } : {}),
  };
}
