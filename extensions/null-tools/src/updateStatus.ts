'use strict';

import { compareVersionTags } from './versionComparison';

export type Progress =
  | { state: 'checking' | 'verifying' | 'preparing' | 'installing' | 'restarting' | 'upToDate' | 'ready' | 'busy' | 'needsReapproval' }
  | { state: 'downloading'; bytes: number; total: number; bytesPerSec: number }
  | { state: 'waitingForClose'; processes: string[] }
  | { state: 'failed'; message: string; log?: string };

type PlainState = 'checking' | 'verifying' | 'preparing' | 'installing' | 'restarting' | 'upToDate' | 'ready' | 'busy' | 'needsReapproval';
const PLAIN = new Set<string>(['checking', 'verifying', 'preparing', 'installing', 'restarting', 'upToDate', 'ready', 'busy', 'needsReapproval']);

export function parseProgressLine(line: string): Progress | undefined {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  switch (o.state) {
    case 'downloading':
      return typeof o.bytes === 'number' && typeof o.total === 'number'
        ? { state: 'downloading', bytes: o.bytes, total: o.total, bytesPerSec: typeof o.bytesPerSec === 'number' ? o.bytesPerSec : 0 }
        : undefined;
    case 'waitingForClose':
      return { state: 'waitingForClose', processes: Array.isArray(o.processes) ? o.processes.filter((p): p is string => typeof p === 'string') : [] };
    case 'failed':
      return typeof o.message === 'string'
        ? { state: 'failed', message: o.message, log: typeof o.log === 'string' ? o.log : undefined }
        : undefined;
    default:
      return typeof o.state === 'string' && PLAIN.has(o.state) ? { state: o.state as PlainState } : undefined;
  }
}

export interface StatusView { text: string; tooltip: string }

export function formatBytes(n: number): string {
  return n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export function statusFor(version: string, p: Progress | undefined, ready: boolean): StatusView {
  if (ready) {
    return { text: '$(rocket) Restart to update', tooltip: `Null IDE ${version} is downloaded and ready to install` };
  }
  switch (p?.state) {
    case 'downloading': {
      const pct = p.total > 0 ? Math.min(100, Math.floor((p.bytes / p.total) * 100)) : 0;
      return {
        text: `$(cloud-download) ${version} ${pct}%`,
        tooltip: `Downloading Null IDE ${version}: ${formatBytes(p.bytes)} of ${formatBytes(p.total)} (${formatBytes(p.bytesPerSec)}/s)`,
      };
    }
    case 'verifying':
      return { text: `$(sync~spin) Verifying ${version}`, tooltip: `Verifying the Null IDE ${version} download` };
    case 'failed':
      return {
        text: `$(warning) Update ${version} failed`,
        tooltip: `${p.message}${p.log ? `\nLog: ${p.log}` : ''}\nClick to try again.`,
      };
    default:
      return { text: `$(cloud-download) ${version}`, tooltip: `Preparing Null IDE ${version}…` };
  }
}

/** Tags become directory names inside null-setup, so mirror its conservative rule. */
export function isSafeTag(tag: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(tag) && !tag.includes('..');
}

/** Only a journal in step MovedIn means "the new install is in place"; a Started journal belongs to an update still in progress. */
export function shouldAcknowledge(journalText: string | undefined): boolean {
  try { return JSON.parse(journalText ?? '').step === 'MovedIn'; } catch { return false; }
}

/** The remembered "update available" is stale once the running version has caught up (e.g. right after updating). */
export function isStillAvailable(latest: string, current: string): boolean {
  return compareVersionTags(latest, current) > 0;
}
