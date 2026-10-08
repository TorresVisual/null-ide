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

export interface GitResult { code: number; stdout: string; stderr: string }

/** `GitResult.code` when git could not be started at all: not installed, or `cwd` does not exist. */
export const GIT_UNAVAILABLE = -1;

/** Runs `git <args>` in `cwd`, feeding `input` to stdin. Never rejects, never prompts. */
export type GitRun = (cwd: string, args: string[], input?: string) => Promise<GitResult>;

export const runGit: GitRun = (cwd, args, input) => new Promise(resolve => {
  const child = execFile(
    'git',
    args,
    { cwd, timeout: 10_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => {
      if (!err) { resolve({ code: 0, stdout, stderr }); return; }
      // A non-zero exit has a numeric `code`; a failure to start git has a string one ('ENOENT') or none.
      const code = (err as { code?: unknown }).code;
      resolve({ code: typeof code === 'number' ? code : GIT_UNAVAILABLE, stdout, stderr: stderr || err.message });
    },
  );
  child.stdin?.on('error', () => { /* git exited before reading its input; the exit code says what happened */ });
  child.stdin?.end(input ?? '');
});
