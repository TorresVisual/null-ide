'use strict';

import { execFile } from 'node:child_process';

/** The `origin` remote URL of the repo at `cwd`; undefined if it isn't a repo, has no origin, or git is missing. */
export function originUrl(cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}
