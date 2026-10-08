'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { nextPeriodStart } from './stats';
import { DateRange, Interval } from './types';

const FILE_RE = /^intervals-(\d{4})-(\d{2})-.+\.jsonl$/;
const DEFAULT_MAX_BUFFERED = 5_000;
const EVERYTHING: DateRange = { from: -Infinity, to: Infinity };

export interface IntervalStoreOptions {
  dir: string;
  windowId: string;
  maxBuffered?: number;
  log?: (message: string) => void;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseInterval(line: string): Interval | undefined {
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

  /** Splits at local month boundaries; lines stay on the first piece. */
  append(interval: Interval): void {
    let piece = interval;
    for (;;) {
      const boundary = nextPeriodStart(piece.start, 'month');
      if (piece.end <= boundary) {
        this.push(piece);
        return;
      }
      this.push({ ...piece, end: boundary });
      piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
    }
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
    for (const name of this.listFiles(range)) out.push(...this.parseFile(path.join(this.opts.dir, name)));
    out.push(...this.buffer);
    return out.filter((i) => overlaps(i, range));
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

  private push(i: Interval): void {
    this.buffer.push(i);
    const max = this.opts.maxBuffered ?? DEFAULT_MAX_BUFFERED;
    if (this.buffer.length > max) {
      this.buffer.splice(0, this.buffer.length - max);
      this.opts.log?.(`Interval buffer full (${max}); dropped the oldest unsaved intervals.`);
    }
  }

  private fileFor(month: string): string {
    return path.join(this.opts.dir, `intervals-${month}-${this.opts.windowId}.jsonl`);
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
