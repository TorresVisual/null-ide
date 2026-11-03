import { Command } from './commandLine';
import { RunResult } from './runner';

// Shared by the CLI and the extension: the two result lines are the whole contract.
// A killed process (no exit code) is 255, never 0.
export function exitCodeOf(r: RunResult): number {
  if (r.timedOut) return 124;
  return r.code ?? 255;
}

export function formatResult(cmd: Command, r: RunResult, logPath: string | undefined, warning?: string): string {
  const secs = Math.round(r.seconds);
  const head = r.timedOut
    ? `null-unreal ${cmd}: timed out after ${secs}s`
    : `null-unreal ${cmd}: exit ${exitCodeOf(r)} in ${secs}s`;
  const log = logPath !== undefined ? `log: ${logPath}` : `log: not kept (${warning ?? 'unknown'})`;
  return `${head}\n${log}`;
}

export function parseLogPath(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = /^log: (?!not kept)(.+)$/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}
