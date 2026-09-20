'use strict';

import { execSync } from 'child_process';
import { GithubRepoRef } from './types';

export function parseGithubRemote(remoteUrl: string): GithubRepoRef | null {
  const trimmed = remoteUrl.trim();
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

export function getWorkspaceGithubRepo(cwd: string): GithubRepoRef | null {
  try {
    const url = execSync('git remote get-url origin', { cwd, encoding: 'utf8', timeout: 5000 });
    return parseGithubRemote(url);
  } catch {
    return null;
  }
}
