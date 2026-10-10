'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

type DashboardRange = 'today' | 'yesterday' | 'week' | 'month' | 'all';

interface DashboardBar {
  label: string;
  startMs: number;
  ms: number;
}

interface Share {
  name: string;
  ms: number;
  /** Rounded; a list of shares sums to 100 ± rounding. */
  percent: number;
  /** Project rows only (not "Other"): the project key git results are matched on. */
  key?: string;
}

interface SessionRow {
  start: number;
  end: number;
  ms: number;
  projects: string[];
  languages: string[];
  files: string[];
}

interface GitTotals {
  commits: number;
  /** Distinct paths touched. */
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

interface DashboardGit {
  /** Sum over `byProject`. */
  totals: GitTotals;
  /** Keyed by `Share.key`. Only projects that have a git result. */
  byProject: Record<string, GitTotals>;
}

interface DashboardModel {
  range: DashboardRange;
  /** "Today", "Mon 5 – Sun 11 Oct", ... */
  rangeLabel: string;
  /** `null-activity.enabled` */
  enabled: boolean;
  totalMs: number;
  bars: DashboardBar[];
  barUnit: 'hour' | 'day' | 'month';
  /** Ranked, max 8, remainder folded into "Other". */
  projects: Share[];
  languages: Share[];
  /** Newest first, max 50. */
  sessions: SessionRow[];
  /** Absent until a load has finished, and when nothing resolved. */
  git?: DashboardGit;
}

type HostToWebview = { type: 'model'; model: DashboardModel };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'setRange'; range: DashboardRange }
  | { type: 'enableTracking' }
  | { type: 'showTrackedData' }
  | { type: 'openSettings' };
