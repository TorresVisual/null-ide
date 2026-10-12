/// <reference path="./protocol.ts" />
'use strict';

import { Report } from './types';

/** A slowdown is a regression only if it is both noticeable in absolute terms and relative to the baseline. */
export const MIN_REGRESSION_MS = 50;
export const MIN_REGRESSION_RATIO = 0.1;

export interface Baseline {
  headlineMs?: number;
  phases: Record<string, number>;
  extensions: Record<string, number>;
}

const defined = (e: [string, number | undefined]): e is [string, number] => e[1] !== undefined;

export function baselineOf(r: Report): Baseline {
  return {
    headlineMs: r.headlineMs,
    phases: Object.fromEntries(r.phases.map((p): [string, number | undefined] => [p.id, p.durationMs]).filter(defined)),
    extensions: Object.fromEntries(r.extensions.map((e): [string, number | undefined] => [e.id, e.totalMs]).filter(defined)),
  };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medians(maps: Record<string, number>[]): Record<string, number> {
  const keys = new Set(maps.flatMap((m) => Object.keys(m)));
  const out: Record<string, number> = {};
  for (const k of keys) {
    const m = median(maps.map((x) => x[k]).filter((v) => v !== undefined));
    if (m !== undefined) out[k] = m;
  }
  return out;
}

export function medianBaseline(rs: Report[]): Baseline {
  const bs = rs.map(baselineOf);
  return {
    headlineMs: median(bs.map((b) => b.headlineMs).filter((v): v is number => v !== undefined)),
    phases: medians(bs.map((b) => b.phases)),
    extensions: medians(bs.map((b) => b.extensions)),
  };
}

function row(id: string, label: string, baseMs: number | undefined, currentMs: number | undefined): DeltaVM {
  const deltaMs = baseMs !== undefined && currentMs !== undefined ? currentMs - baseMs : undefined;
  const regression =
    deltaMs !== undefined && deltaMs >= MIN_REGRESSION_MS && (baseMs === 0 || deltaMs / (baseMs as number) >= MIN_REGRESSION_RATIO);
  return { id, label, baseMs, currentMs, deltaMs, regression };
}

const bySlowdown = (a: DeltaVM, b: DeltaVM) => (b.deltaMs ?? -Infinity) - (a.deltaMs ?? -Infinity);

export function compare(current: Report, base: Baseline, baseLabel: string): ComparisonVM {
  const phaseNow = new Map(current.phases.map((p) => [p.id, p]));
  const extNow = new Map(current.extensions.map((e) => [e.id, e]));
  const phaseIds = [...new Set([...phaseNow.keys(), ...Object.keys(base.phases)])];
  const extIds = [...new Set([...extNow.keys(), ...Object.keys(base.extensions)])];
  return {
    baseLabel,
    headline: row('headline', 'Startup (workspace restored)', base.headlineMs, current.headlineMs),
    phases: phaseIds.map((id) => row(id, phaseNow.get(id)?.label ?? id, base.phases[id], phaseNow.get(id)?.durationMs)).sort(bySlowdown),
    extensions: extIds.map((id) => row(id, id, base.extensions[id], extNow.get(id)?.totalMs)).sort(bySlowdown),
  };
}
