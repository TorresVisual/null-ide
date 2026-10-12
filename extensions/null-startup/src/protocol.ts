'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

type BaselineKind = 'previous' | 'median' | 'none';

interface DeltaVM {
  id: string;
  label: string;
  baseMs?: number;
  currentMs?: number;
  /** current − base; undefined when either side is missing. */
  deltaMs?: number;
  regression: boolean;
}

interface ComparisonVM {
  baseLabel: string;
  headline: DeltaVM;
  phases: DeltaVM[];
  extensions: DeltaVM[];
}

interface MilestoneVM {
  id: string;
  label: string;
  atMs?: number;
}

interface PhaseVM {
  id: string;
  label: string;
  process: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  impactMs?: number;
}

interface ExtensionVM {
  id: string;
  activationEvent: string;
  reason: string;
  deferred: boolean;
  startMs?: number;
  endMs?: number;
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
  totalMs?: number;
  impactMs?: number;
  /** totalMs >= the slow threshold. A flag, not a verdict. */
  slow: boolean;
  /** Timeline lane; 0 when the activation has no start/end stamps. */
  lane: number;
}

interface LaunchOption {
  id: string;
  label: string;
}

interface ReportViewModel {
  hasReport: boolean;
  reportId?: string;
  launches: LaunchOption[];
  baseline: BaselineKind;
  appVersion?: string;
  partial: boolean;
  headlineMs?: number;
  /** Timeline width in ms (≥ 1). */
  spanMs: number;
  slowMs: number;
  milestones: MilestoneVM[];
  phases: PhaseVM[];
  extensions: ExtensionVM[];
  slowestPhases: PhaseVM[];
  slowestExtensions: ExtensionVM[];
  comparison?: ComparisonVM;
}

type HostToWebview = { type: 'model'; model: ReportViewModel };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'select'; reportId: string }
  | { type: 'setBaseline'; baseline: BaselineKind }
  | { type: 'copy' }
  | { type: 'export' };
