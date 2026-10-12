/// <reference path="./protocol.ts" />
'use strict';

import { baselineOf, compare, medianBaseline } from './compare';
import { fmtMs, stamp } from './format';
import { assignLanes } from './intervals';
import { Report } from './types';

const BASELINES: BaselineKind[] = ['previous', 'median', 'none'];

export function parseWebviewMessage(raw: unknown): WebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as { type?: unknown; reportId?: unknown; baseline?: unknown };
  switch (m.type) {
    case 'ready':
    case 'copy':
    case 'export':
      return { type: m.type };
    case 'select':
      return typeof m.reportId === 'string' ? { type: 'select', reportId: m.reportId } : undefined;
    case 'setBaseline':
      return BASELINES.includes(m.baseline as BaselineKind) ? { type: 'setBaseline', baseline: m.baseline as BaselineKind } : undefined;
    default:
      return undefined;
  }
}

const launchLabel = (r: Report) => `${stamp(r.takenAt)} · ${fmtMs(r.headlineMs)}${r.partial ? ' (partial)' : ''}`;

/** `history` is newest first. */
export function buildViewModel(history: Report[], opts: { selectedId?: string; baseline: BaselineKind; slowMs: number }): ReportViewModel {
  const launches = history.map((r) => ({ id: r.id, label: launchLabel(r) }));
  const current = history.find((r) => r.id === opts.selectedId) ?? history[0];
  if (!current) {
    return {
      hasReport: false, launches, baseline: opts.baseline, partial: false, spanMs: 1, slowMs: opts.slowMs,
      milestones: [], phases: [], extensions: [], slowestPhases: [], slowestExtensions: [],
    };
  }

  const lanes = assignLanes(current.extensions.map((e) => (e.startMs !== undefined && e.endMs !== undefined ? { start: e.startMs, end: e.endMs } : undefined)));
  const extensions: ExtensionVM[] = current.extensions.map((e, i) => ({
    id: e.id, activationEvent: e.activationEvent, reason: e.reason, deferred: e.deferred,
    startMs: e.startMs, endMs: e.endMs, loadMs: e.loadMs, callMs: e.callMs, resolveMs: e.resolveMs, totalMs: e.totalMs, impactMs: e.impactMs,
    slow: e.totalMs !== undefined && e.totalMs >= opts.slowMs,
    lane: lanes[i],
  }));
  const phases: PhaseVM[] = current.phases.map((p) => ({ ...p }));
  const milestones: MilestoneVM[] = current.milestones.map((m) => ({ ...m }));

  const ends = [...phases.map((p) => p.endMs), ...extensions.map((e) => e.endMs), ...milestones.map((m) => m.atMs)];
  const spanMs = Math.max(1, ...ends.filter((v): v is number => v !== undefined));

  const older = history.filter((r) => r.takenAt < current.takenAt);
  const others = history.filter((r) => r.id !== current.id);
  let comparison: ComparisonVM | undefined;
  if (opts.baseline === 'previous' && older.length) comparison = compare(current, baselineOf(older[0]), `previous launch (${stamp(older[0].takenAt)})`);
  else if (opts.baseline === 'median' && others.length) comparison = compare(current, medianBaseline(others), `median of ${others.length} other launch${others.length === 1 ? '' : 'es'}`);

  return {
    hasReport: true,
    reportId: current.id,
    launches,
    baseline: opts.baseline,
    appVersion: current.appVersion,
    partial: current.partial,
    headlineMs: current.headlineMs,
    spanMs,
    slowMs: opts.slowMs,
    milestones,
    phases,
    extensions,
    slowestPhases: phases.filter((p) => (p.impactMs ?? 0) > 0).sort((a, b) => (b.impactMs ?? 0) - (a.impactMs ?? 0)).slice(0, 3),
    slowestExtensions: extensions.filter((e) => e.totalMs !== undefined).sort((a, b) => (b.totalMs ?? 0) - (a.totalMs ?? 0)).slice(0, 3),
    comparison,
  };
}
