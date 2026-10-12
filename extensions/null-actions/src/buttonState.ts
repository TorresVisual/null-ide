'use strict';

import { ButtonRunState } from './terminalRegistry';

export function formatDuration(ms: number): string {
  if (ms < 1000) { return `${Math.round(ms)}ms`; }
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const RESULT_ICON = { passed: 'check', failed: 'error', ended: 'debug-stop' } as const;

/** Status bar text for a button: its normal text, or the run state overlaid on it. */
export function statusText(label: string, icon: string | undefined, state: ButtonRunState | undefined): string {
  if (!state) { return icon ? `$(${icon}) ${label}` : label; }
  if (state.kind === 'running') { return `$(sync~spin) ${label}`; }
  return `$(${RESULT_ICON[state.kind]}) ${label} ${formatDuration(state.durationMs)}`;
}

export function statusTooltip(tooltip: string | undefined, state: ButtonRunState | undefined): string | undefined {
  if (!state) { return tooltip; }
  let line: string;
  if (state.kind === 'running') { line = 'Running...'; }
  else if (state.kind === 'passed') { line = `Passed in ${formatDuration(state.durationMs)}`; }
  else if (state.kind === 'failed') { line = `Failed with exit code ${state.exitCode} after ${formatDuration(state.durationMs)} - click to show the terminal`; }
  else { line = `Finished after ${formatDuration(state.durationMs)} (exit code unknown)`; }
  return tooltip ? `${tooltip}\n${line}` : line;
}
