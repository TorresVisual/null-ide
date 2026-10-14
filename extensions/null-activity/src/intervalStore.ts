'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nextPeriodStart } from './stats';
import { DateRange, Interval, MACHINE_ID_RE, MONTH_RE } from './types';

const FILE_RE = /^intervals-(\d{4})-(\d{2})-(.+)\.jsonl$/;
const DEFAULT_MAX_BUFFERED = 5_000;
const REMOTE_DIR = 'machines';
const REMOTE_FILE_RE = /^(\d{4}-\d{2})\.jsonl$/;
const EVERYTHING: DateRange = { from: -Infinity, to: Infinity };

export interface IntervalStoreOptions {
  dir: string;
  windowId: string;
  /** This installation's id (see machineId.ts); tags everything this store wrote. */
  machineId?: string;
  maxBuffered?: number;
  log?: (message: string) => void;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A fresh id per extension-host launch. `env.sessionId` is shared by every window of one app launch, so it cannot tell windows apart. */
export const newWindowId = (): string => crypto.randomBytes(5).toString('hex');

export function parseInterval(line: string): Interval | undefined {
  try {
    const v = JSON.parse(line);
    if (
      Number.isFinite(v.start) && Number.isFinite(v.end) && v.end > v.start &&
      typeof v.project?.key === 'string' && typeof v.project?.name === 'string' && typeof v.language === 'string'
    ) {
      return { ...v, linesAdded: Number(v.linesAdded) || 0, linesRemoved: Number(v.linesRemoved) || 0 };
    }
  } catch {
    // torn or corrupt line
  }
  return undefined;
}

const overlaps = (i: Interval, r: DateRange) => i.end > r.from && i.start < r.to;

export class IntervalStore {
  private buffer: Interval[] = [];

  constructor(private readonly opts: IntervalStoreOptions) {}

  get windowId(): string {
    return this.opts.windowId;
  }

  get machineId(): string {
    return this.opts.machineId ?? 'local';
  }

  /** Splits at local month boundaries; lines stay on the first piece. */
  private split(interval: Interval): Interval[] {
    const out: Interval[] = [];
    let piece = interval;
    for (;;) {
      const boundary = nextPeriodStart(piece.start, 'month');
      if (piece.end <= boundary) {
        out.push(piece);
        return out;
      }
      out.push({ ...piece, end: boundary });
      piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
    }
  }

  append(interval: Interval): void {
    for (const piece of this.split(interval)) this.push(piece);
  }

  /**
   * Appends buffered intervals to this window's monthly files. Sync on purpose so `dispose`
   * can flush. ponytail: one file per window session per month; add compaction if file count matters.
   */
  flush(): void {
    if (this.buffer.length === 0) return;
    try {
      fs.mkdirSync(this.opts.dir, { recursive: true });
    } catch (err) {
      this.fail(err);
      return;
    }
    const byMonth = new Map<string, Interval[]>();
    for (const i of this.buffer) {
      const key = monthKey(i.start);
      byMonth.set(key, [...(byMonth.get(key) ?? []), i]);
    }
    const remaining: Interval[] = [];
    for (const [month, items] of byMonth) {
      // The leading newline isolates a torn last line left by an earlier crash.
      const chunk = '\n' + items.map((i) => JSON.stringify(i)).join('\n') + '\n';
      try {
        fs.appendFileSync(this.fileFor(month), chunk);
      } catch (err) {
        this.fail(err);
        remaining.push(...items);
      }
    }
    this.buffer = remaining;
  }

  read(range: DateRange): Interval[] {
    const out: Interval[] = [];
    for (const name of this.listFiles(range)) {
      const window = FILE_RE.exec(name)![3];
      for (const i of this.parseFile(path.join(this.opts.dir, name))) out.push({ ...i, window, machine: this.machineId });
    }
    for (const i of this.buffer) out.push({ ...i, window: this.opts.windowId, machine: this.machineId });
    for (const { machine, month } of this.remoteMonths()) {
      const start = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).getTime();
      if (nextPeriodStart(start, 'month') <= range.from || start >= range.to) continue;
      for (const i of this.parseFile(this.remoteFile(machine, month))) out.push({ ...i, window: i.window ?? '', machine });
    }
    return out.filter((i) => overlaps(i, range));
  }

  /** Months (`YYYY-MM`) for which this machine has data on disk, oldest first. */
  ownMonths(): string[] {
    this.flush();
    const months = new Set<string>();
    for (const name of this.listFiles(EVERYTHING)) {
      const m = FILE_RE.exec(name)!;
      months.add(`${m[1]}-${m[2]}`);
    }
    return [...months].sort();
  }

  /** Everything this machine recorded in `month`, every window (imports included), tagged with its window. */
  exportOwn(month: string): Interval[] {
    this.flush();
    const out: Interval[] = [];
    for (const name of this.listFiles(EVERYTHING).sort()) {
      const m = FILE_RE.exec(name)!;
      if (`${m[1]}-${m[2]}` !== month) continue;
      for (const i of this.parseFile(path.join(this.opts.dir, name))) out.push({ ...i, window: m[3] });
    }
    return out;
  }

  /** The cached month files of other machines. */
  remoteMonths(): { machine: string; month: string }[] {
    const out: { machine: string; month: string }[] = [];
    const root = path.join(this.opts.dir, REMOTE_DIR);
    let machines: string[];
    try {
      machines = fs.readdirSync(root);
    } catch {
      return out;
    }
    for (const machine of machines.filter((id) => MACHINE_ID_RE.test(id))) {
      for (const name of fs.readdirSync(path.join(root, machine), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
        const m = REMOTE_FILE_RE.exec(name);
        if (m) out.push({ machine, month: m[1] });
      }
    }
    return out;
  }

  /** Replaces another machine's cached month. Throws on an invalid id or month (remote names are untrusted). */
  replaceRemote(machine: string, month: string, intervals: Interval[]): void {
    const file = this.remoteFile(machine, month);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.rewrite(file, intervals.map(({ machine: _machine, ...i }) => i));
  }

  removeRemote(machine: string, month: string): void {
    fs.rmSync(this.remoteFile(machine, month), { force: true });
  }

  private remoteFile(machine: string, month: string): string {
    if (!MACHINE_ID_RE.test(machine) || !MONTH_RE.test(month)) throw new Error('invalid machine or month');
    return path.join(this.opts.dir, REMOTE_DIR, machine, `${month}.jsonl`);
  }

  /**
   * Drops every interval overlapping the range, so it can over-delete one interval at each edge.
   * ponytail: rewriting another window's file can race with its append; acceptable for a manual action.
   */
  deleteRange(range: DateRange): void {
    this.flush();
    this.buffer = this.buffer.filter((i) => !overlaps(i, range));
    for (const name of this.listFiles(range)) {
      const file = path.join(this.opts.dir, name);
      this.rewrite(file, this.parseFile(file).filter((i) => !overlaps(i, range)));
    }
  }

  deleteAll(): void {
    this.buffer = [];
    for (const name of this.listFiles(EVERYTHING)) fs.rmSync(path.join(this.opts.dir, name), { force: true });
  }

  /**
   * Replaces every file of `windowId` with `intervals` (used by imports). Writes straight to disk, so the
   * buffer cap does not apply; throws on write failure, leaving files that were not yet replaced intact.
   */
  replaceWindow(windowId: string, intervals: Interval[]): void {
    const byMonth = new Map<string, Interval[]>();
    for (const i of intervals) {
      for (const piece of this.split(i)) {
        const month = monthKey(piece.start);
        const list = byMonth.get(month);
        if (list) list.push(piece);
        else byMonth.set(month, [piece]);
      }
    }
    fs.mkdirSync(this.opts.dir, { recursive: true });
    const fresh = new Set<string>();
    for (const [month, items] of byMonth) {
      const file = this.fileFor(month, windowId);
      this.rewrite(file, items);
      fresh.add(path.basename(file));
    }
    for (const name of this.windowFiles(windowId)) {
      if (!fresh.has(name)) fs.rmSync(path.join(this.opts.dir, name), { force: true });
    }
  }

  hasWindow(windowId: string): boolean {
    return this.windowFiles(windowId).length > 0;
  }

  private push(i: Interval): void {
    this.buffer.push(i);
    const max = this.opts.maxBuffered ?? DEFAULT_MAX_BUFFERED;
    if (this.buffer.length > max) {
      this.buffer.splice(0, this.buffer.length - max);
      this.opts.log?.(`Interval buffer full (${max}); dropped the oldest unsaved intervals.`);
    }
  }

  private fileFor(month: string, windowId = this.opts.windowId): string {
    return path.join(this.opts.dir, `intervals-${month}-${windowId}.jsonl`);
  }

  private windowFiles(windowId: string): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.opts.dir);
    } catch {
      return [];
    }
    return names.filter((name) => name.replace(/^intervals-\d{4}-\d{2}-/, '') === `${windowId}.jsonl`);
  }

  private listFiles(range: DateRange): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.opts.dir);
    } catch {
      return [];
    }
    return names.filter((name) => {
      const m = FILE_RE.exec(name);
      if (!m) return false;
      const start = new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
      return nextPeriodStart(start, 'month') > range.from && start < range.to;
    });
  }

  private parseFile(file: string): Interval[] {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      this.fail(err);
      return [];
    }
    return text.split('\n').flatMap((line) => (line.trim() ? parseInterval(line) ?? [] : []));
  }

  private rewrite(file: string, intervals: Interval[]): void {
    if (intervals.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, intervals.map((i) => JSON.stringify(i) + '\n').join(''));
    fs.renameSync(tmp, file);
  }

  private fail(err: unknown): void {
    this.opts.log?.(`Storage error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
