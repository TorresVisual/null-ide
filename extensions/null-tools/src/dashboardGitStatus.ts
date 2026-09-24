'use strict';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  dirty: boolean;
}

async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 });
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    return { branch: branch.trim(), dirty: porcelain.trim().length > 0 };
  } catch {
    return null;
  }
}

/**
 * Computes git status for each path with at most `concurrency` shell-outs in
 * flight at once, calling onResult(path, status) as each one resolves (not
 * all at once) so the caller can update the UI progressively. A failing or
 * throwing fetch for one path never blocks or fails the rest of the batch.
 */
export async function computeGitStatuses(
  paths: string[],
  onResult: (path: string, status: GitStatus | null) => void,
  concurrency = 4,
  fetchStatus: (cwd: string) => Promise<GitStatus | null> = getGitStatus,
): Promise<void> {
  let next = 0;

  async function worker(): Promise<void> {
    while (next < paths.length) {
      const index = next++;
      const p = paths[index];
      let status: GitStatus | null;
      try {
        status = await fetchStatus(p);
      } catch {
        status = null;
      }
      onResult(p, status);
    }
  }

  const workerCount = Math.min(concurrency, paths.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}
