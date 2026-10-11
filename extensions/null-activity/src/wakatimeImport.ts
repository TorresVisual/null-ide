'use strict';

import { languageId } from './languageMap';
import { NO_FOLDER } from './projectIdentity';
import { Interval } from './types';

export const WAKATIME_WINDOW_ID = 'import-wakatime';
const DEFAULT_TIMEOUT_MIN = 15;

export interface ResolvedWakaProject {
  key: string;
  name: string;
  root?: string;
}

/** `dir` is the project's most common heartbeat directory (forward slashes); undefined = not found here. */
export type WakaProjectResolver = (projectName: string, dir: string) => ResolvedWakaProject | undefined;

export interface ImportSummary {
  days: number; // days that produced at least one interval
  totalMs: number; // before overlaps with other data are clipped
  heartbeats: number; // entries read, including skipped ones
  skipped: number; // malformed: no numeric time
  appHeartbeats: number;
  projectsResolved: number; // matched to a local git repo
  projectsByName: number; // kept as the WakaTime name
  timeoutMs: number;
}

interface Beat {
  t: number; // epoch ms
  project: string;
  language: string;
  entity: string;
  app: boolean;
}

interface Context {
  key: string;
  name: string;
  language: string;
  file: string | undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const slash = (p: string): string => p.replace(/\\/g, '/');
const dirOf = (entity: string): string => {
  const e = slash(entity);
  const i = e.lastIndexOf('/');
  return i <= 0 ? '' : e.slice(0, i);
};

function fileOf(entity: string, root: string | undefined): string {
  const e = slash(entity);
  if (root) {
    const prefix = slash(root).replace(/\/+$/, '') + '/';
    if (e.toLowerCase().startsWith(prefix.toLowerCase())) return e.slice(prefix.length);
  }
  return e.slice(e.lastIndexOf('/') + 1);
}

function resolveProjects(beats: Beat[], resolve: WakaProjectResolver) {
  const names = new Set<string>();
  const dirCounts = new Map<string, Map<string, number>>();
  for (const b of beats) {
    if (b.app || !b.project) continue;
    names.add(b.project);
    const dir = dirOf(b.entity);
    if (!dir.includes('/')) continue;
    const counts = dirCounts.get(b.project) ?? new Map<string, number>();
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
    dirCounts.set(b.project, counts);
  }
  const projects = new Map<string, ResolvedWakaProject>();
  let resolved = 0;
  for (const name of names) {
    const counts = dirCounts.get(name);
    const top = counts && [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    let found: ResolvedWakaProject | undefined;
    try {
      found = top ? resolve(name, top) : undefined;
    } catch {
      found = undefined; // an unreadable folder must not fail the import
    }
    if (found) resolved++;
    projects.set(name, found ?? { key: name, name });
  }
  return { projects, resolved, byName: names.size - resolved };
}

function contextOf(b: Beat, projects: Map<string, ResolvedWakaProject>): Context {
  if (b.app) return { key: NO_FOLDER, name: NO_FOLDER, language: '', file: undefined };
  const p: ResolvedWakaProject = (b.project && projects.get(b.project)) || { key: NO_FOLDER, name: NO_FOLDER };
  return { key: p.key, name: p.name, language: languageId(b.language), file: fileOf(b.entity, p.root) || undefined };
}

/**
 * Heartbeats → intervals with WakaTime's own rule: a heartbeat counts until the next one when the gap
 * is within the export's timeout.
 */
export function convertExport(data: unknown, resolve: WakaProjectResolver): { intervals: Interval[]; summary: ImportSummary } {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { days?: unknown }).days)) {
    throw new Error('Not a WakaTime export: no "days" list found.');
  }
  const root = data as { days: unknown[]; user?: { timeout?: unknown } };
  const userTimeout = Number(root.user?.timeout);
  const timeoutMs = (Number.isFinite(userTimeout) && userTimeout > 0 ? userTimeout : DEFAULT_TIMEOUT_MIN) * 60_000;

  const beats: Beat[] = [];
  let seen = 0;
  let skipped = 0;
  for (const day of root.days) {
    const list = (day as { heartbeats?: unknown } | null)?.heartbeats;
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      seen++;
      const time = (h as { time?: unknown } | null)?.time;
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        skipped++;
        continue;
      }
      const r = h as Record<string, unknown>;
      beats.push({ t: Math.round(time * 1000), project: str(r.project), language: str(r.language), entity: str(r.entity), app: r.type === 'app' });
    }
  }
  beats.sort((a, b) => a.t - b.t);

  const { projects, resolved, byName } = resolveProjects(beats, resolve);
  const contexts = beats.map((b) => contextOf(b, projects));

  const intervals: Interval[] = [];
  let open: Interval | undefined;
  for (let i = 0; i + 1 < beats.length; i++) {
    const start = beats[i].t;
    const end = beats[i + 1].t;
    const gap = end - start;
    if (gap <= 0 || gap > timeoutMs) continue;
    const c = contexts[i];
    if (open && open.end === start && open.project.key === c.key && open.language === c.language && open.file === c.file) {
      open.end = end;
      continue;
    }
    open = {
      start,
      end,
      project: { key: c.key, name: c.name },
      language: c.language,
      ...(c.file !== undefined ? { file: c.file } : {}),
      linesAdded: 0,
      linesRemoved: 0,
    };
    intervals.push(open);
  }

  return {
    intervals,
    summary: {
      days: new Set(intervals.map((i) => new Date(i.start).toDateString())).size,
      totalMs: intervals.reduce((sum, i) => sum + i.end - i.start, 0),
      heartbeats: seen,
      skipped,
      appHeartbeats: beats.filter((b) => b.app).length,
      projectsResolved: resolved,
      projectsByName: byName,
      timeoutMs,
    },
  };
}

export function formatSummary(s: ImportSummary): string {
  const parts = [
    `Imported ${(s.totalMs / 3_600_000).toFixed(1)} h over ${s.days} days.`,
    `Projects: ${s.projectsResolved} matched to local repos, ${s.projectsByName} kept by WakaTime name.`,
  ];
  if (s.appHeartbeats) parts.push(`${s.appHeartbeats} app heartbeats went to "${NO_FOLDER}".`);
  if (s.skipped) parts.push(`Skipped ${s.skipped} malformed heartbeats.`);
  parts.push(`Gaps up to ${s.timeoutMs / 60_000} min count as active, so imported time is measured more generously than live tracking.`);
  return parts.join(' ');
}
