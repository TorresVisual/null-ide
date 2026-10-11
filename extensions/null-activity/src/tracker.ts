'use strict';

import { Heartbeat, Interval, ResolvedProject } from './types';

export interface TrackerOptions {
  clock: () => number;
  idleTimeoutMs: () => number;
  resolveProject: (workspace: string | undefined) => ResolvedProject;
  onInterval: (interval: Interval) => void;
}

interface OpenInterval {
  start: number;
  last: number;
  workspace: string | undefined;
  language: string;
  file: string | undefined;
  project: ResolvedProject;
  linesAdded: number;
  linesRemoved: number;
}

export class Tracker {
  private open: OpenInterval | undefined;
  private focused = true;
  private active = true;

  constructor(private readonly opts: TrackerOptions) {}

  heartbeat(h: Heartbeat): void {
    if (!this.active || !this.focused) return;
    const o = this.open;
    const sameContext = !!o && o.workspace === h.workspace && o.language === h.language && o.file === h.file;
    if (o && sameContext && h.ts >= o.last && h.ts - o.last <= this.opts.idleTimeoutMs()) {
      o.last = h.ts;
      o.linesAdded += h.linesAdded;
      o.linesRemoved += h.linesRemoved;
      return;
    }
    this.close(h.ts);
    this.open = {
      start: h.ts,
      last: h.ts,
      workspace: h.workspace,
      language: h.language,
      file: h.file,
      project: this.opts.resolveProject(h.workspace),
      linesAdded: h.linesAdded,
      linesRemoved: h.linesRemoved,
    };
  }

  setFocused(focused: boolean): void {
    if (!focused) this.closeAtLast();
    this.focused = focused;
  }

  setActive(active: boolean): void {
    if (!active) this.closeAtLast();
    this.active = active;
  }

  /** Closes a stale interval even when no new heartbeat arrives. */
  tick(): void {
    const o = this.open;
    const now = this.opts.clock();
    if (o && now - o.last > this.opts.idleTimeoutMs()) this.close(now);
  }

  closeOpen(): void {
    this.closeAtLast();
  }

  /** The in-progress interval up to its last heartbeat, for live readouts. */
  peek(): Interval | undefined {
    const o = this.open;
    return o && o.last > o.start ? this.toInterval(o, o.last) : undefined;
  }

  /** No heartbeat to close on: end at the last one, so a long idle timeout never credits silence. */
  private closeAtLast(): void {
    if (this.open) this.close(this.open.last);
  }

  private close(t: number): void {
    const o = this.open;
    if (!o) return;
    this.open = undefined;
    const end = t < o.last || t - o.last > this.opts.idleTimeoutMs() ? o.last : t;
    if (end <= o.start) return;
    this.opts.onInterval(this.toInterval(o, end));
  }

  private toInterval(o: OpenInterval, end: number): Interval {
    return {
      start: o.start,
      end,
      project: { key: o.project.key, name: o.project.name },
      language: o.language,
      ...(o.file !== undefined ? { file: o.file } : {}),
      ...(o.project.branch ? { branch: o.project.branch } : {}),
      linesAdded: o.linesAdded,
      linesRemoved: o.linesRemoved,
    };
  }
}

interface TextChange {
  text: string;
  range: { start: { line: number }; end: { line: number } };
}

/** Lines added = newlines inserted; lines removed = lines spanned by the replaced range. */
export function lineDelta(changes: readonly TextChange[]): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const c of changes) {
    for (let i = c.text.indexOf('\n'); i !== -1; i = c.text.indexOf('\n', i + 1)) linesAdded++;
    linesRemoved += c.range.end.line - c.range.start.line;
  }
  return { linesAdded, linesRemoved };
}
