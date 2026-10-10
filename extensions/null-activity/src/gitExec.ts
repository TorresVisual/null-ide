'use strict';

import { execFile } from 'child_process';

/** The only place that spawns git. No shell; read-only use, so never take optional locks. Rejects on a non-zero exit, timeout or output over the cap. */
export function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}
