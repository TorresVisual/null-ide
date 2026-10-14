'use strict';

import { execFile } from 'child_process';

export type RunGit = (args: string[]) => Promise<string>;

export class GitError extends Error {
  constructor(message: string, readonly stderr: string, readonly code: number | string | undefined) {
    super(message);
    this.name = 'GitError';
  }
}

// GIT_OPTIONAL_LOCKS=0: background reads never take index.lock, so they cannot make the user's own commit fail.
// GIT_EDITOR=true: `--continue` never blocks on an editor. LC_ALL=C: stable English messages.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' };

/** The only place the graph spawns git. Reads use the 15 s default; actions pass a longer timeout. */
export function makeRunGit(cwd: string, timeoutMs = 15_000): RunGit {
  return (args) => new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) { resolve(stdout); return; }
        const text = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join('\n') || err.message;
        reject(new GitError(text, stderr, (err as NodeJS.ErrnoException).code));
      },
    );
  });
}

/** One action at a time per repo. Reads wait for the running action with whenIdle(). */
export class BusyFlag {
  private current: Promise<unknown> | undefined;

  get busy(): boolean {
    return this.current !== undefined;
  }

  async run<T>(fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.current) return { ran: false };
    const running = fn();
    this.current = running;
    try {
      return { ran: true, value: await running };
    } finally {
      this.current = undefined;
    }
  }

  async whenIdle(): Promise<void> {
    while (this.current) {
      try { await this.current; } catch { /* the action reports its own failure */ }
    }
  }
}
