'use strict';

import { Emitter, Event } from './emitter';
import { IntervalStore } from './intervalStore';
import { ALL_TIME, languageStats, normalizeIntervals, periodStats, projectStats, sessions } from './stats';
import { Tracker } from './tracker';
import { WAKATIME_WINDOW_ID } from './wakatimeImport';
import {
  DailyStat, DateRange, Heartbeat, Interval, LanguageStat, NullActivityApi, ProjectStat, ResolvedProject, Session,
} from './types';

const CACHE_TTL_MS = 15_000;

export interface ActivitySettings {
  enabled: boolean;
  idleTimeoutMs: number;
  sessionGapMs: number;
}

export interface ActivityServiceOptions {
  store: IntervalStore;
  resolveProject: (workspace: string | undefined) => ResolvedProject;
  settings: () => ActivitySettings;
  clock?: () => number;
}

export function normalizeSettings(raw: { enabled?: unknown; idleTimeout?: unknown; sessionGap?: unknown }): ActivitySettings {
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    enabled: raw.enabled !== false,
    idleTimeoutMs: num(raw.idleTimeout, 900, 10, 3_600) * 1_000,
    sessionGapMs: num(raw.sessionGap, 15, 1, 1_440) * 60_000,
  };
}

export class ActivityService implements NullActivityApi {
  private readonly changed = new Emitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;

  private readonly tracker: Tracker;
  private readonly clock: () => number;
  private cfg: ActivitySettings;
  private paused = false;
  private cache = new Map<string, { at: number; intervals: Interval[] }>();

  constructor(private readonly opts: ActivityServiceOptions) {
    this.clock = opts.clock ?? Date.now;
    this.cfg = { ...opts.settings() };
    this.tracker = new Tracker({
      clock: this.clock,
      idleTimeoutMs: () => this.cfg.idleTimeoutMs,
      resolveProject: opts.resolveProject,
      onInterval: (interval) => {
        opts.store.append(interval);
        this.dataChanged();
      },
    });
    this.refresh();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** Re-reads settings; call on configuration change. Disabling closes the open interval immediately. */
  refresh(): void {
    this.cfg = { ...this.opts.settings() };
    this.tracker.setActive(this.cfg.enabled && !this.paused);
  }

  startSession(): void {
    this.paused = false;
    this.refresh();
  }

  pauseSession(): void {
    this.paused = true;
    this.refresh();
  }

  endSession(): void {
    this.tracker.closeOpen();
    this.opts.store.flush();
  }

  recordActivity(h: Heartbeat): void {
    this.tracker.heartbeat(h);
  }

  setFocused(focused: boolean): void {
    this.tracker.setFocused(focused);
  }

  tick(): void {
    this.tracker.tick();
  }

  flush(): void {
    this.opts.store.flush();
  }

  /** Merged across windows, clipped to the range, including the in-progress interval. */
  getIntervals(range: DateRange): Interval[] {
    const key = `${range.from}:${range.to}`;
    let hit = this.cache.get(key);
    if (!hit || this.clock() - hit.at >= CACHE_TTL_MS) {
      hit = { at: this.clock(), intervals: this.opts.store.read(range) };
      this.cache.set(key, hit);
    }
    const open = this.tracker.peek();
    return normalizeIntervals(open ? [...hit.intervals, open] : hit.intervals, range);
  }

  getProjectStats(range: DateRange): ProjectStat[] {
    return projectStats(this.getIntervals(range), range);
  }

  getLanguageStats(range: DateRange): LanguageStat[] {
    return languageStats(this.getIntervals(range), range);
  }

  getDailyStats(range: DateRange): DailyStat[] {
    return periodStats(this.getIntervals(range), range, 'day');
  }

  getSessions(range: DateRange): Session[] {
    return sessions(this.getIntervals(range), range, this.cfg.sessionGapMs);
  }

  getMonthlyTotals(): DailyStat[] {
    return periodStats(this.getIntervals(ALL_TIME), ALL_TIME, 'month');
  }

  /** Closes the open interval first so it is deleted with the rest instead of reappearing. */
  deleteRange(range: DateRange): void {
    this.tracker.closeOpen();
    this.opts.store.deleteRange(range);
    this.dataChanged();
  }

  deleteAll(): void {
    this.tracker.closeOpen();
    this.opts.store.deleteAll();
    this.dataChanged();
  }

  /** Swaps the previous WakaTime import for `intervals`. Internal: deliberately not on `NullActivityApi`. */
  replaceImported(intervals: Interval[]): void {
    this.opts.store.replaceWindow(WAKATIME_WINDOW_ID, intervals);
    this.dataChanged();
  }

  hasImport(): boolean {
    return this.opts.store.hasWindow(WAKATIME_WINDOW_ID);
  }

  dispose(): void {
    this.endSession();
    this.changed.dispose();
  }

  private dataChanged(): void {
    this.cache.clear();
    this.changed.fire();
  }
}
