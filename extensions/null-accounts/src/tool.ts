'use strict';

import { execFile } from 'node:child_process';

export interface ToolResult { code: number; stdout: string; stderr: string }

/** `ToolResult.code` when the program could not run at all: not installed, killed by the timeout, or not startable. */
export const TOOL_UNAVAILABLE = -1;

export interface ToolOptions { env?: NodeJS.ProcessEnv; timeoutMs?: number }

/** Runs `command args…`. Never rejects. */
export type RunTool = (command: string, args: string[], options?: ToolOptions) => Promise<ToolResult>;

export const runTool: RunTool = (command, args, options = {}) => new Promise(resolve => {
  const child = execFile(
    command,
    args,
    { env: { ...process.env, ...options.env }, timeout: options.timeoutMs ?? 15_000, windowsHide: true },
    (err, stdout, stderr) => {
      if (!err) { resolve({ code: 0, stdout, stderr }); return; }
      // A non-zero exit has a numeric `code`; a failure to start has a string one ('ENOENT') or none.
      const code = (err as { code?: unknown }).code;
      resolve({ code: typeof code === 'number' ? code : TOOL_UNAVAILABLE, stdout, stderr: stderr || err.message });
    },
  );
  // Nothing will ever answer a prompt: end stdin so a tool that reads it stops waiting.
  child.stdin?.on('error', () => { /* the tool exited before reading; its exit code says what happened */ });
  child.stdin?.end();
});
