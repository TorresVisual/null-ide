'use strict';

import { Event } from './emitter';

export interface ProjectRef {
  key: string;
  name: string;
}

export interface ResolvedProject extends ProjectRef {
  branch?: string;
}

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms, > start
  project: ProjectRef;
  language: string; // languageId, '' for terminal/unknown
  file?: string; // workspace-relative path
  branch?: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface Heartbeat {
  ts: number;
  file?: string;
  language: string;
  workspace?: string; // workspace folder fsPath
  isWrite: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/** Half-open, epoch ms. */
export interface DateRange {
  from: number;
  to: number;
}

export interface ProjectStat {
  project: ProjectRef;
  ms: number;
  files: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface LanguageStat {
  language: string;
  ms: number;
}

/** `day` is the local `YYYY-MM-DD` of the bucket start (day, week or month). */
export interface DailyStat {
  day: string;
  ms: number;
}

export interface Session {
  start: number;
  end: number;
  durationMs: number;
  projects: ProjectRef[];
  languages: string[];
  files: string[];
}

export interface NullActivityApi {
  startSession(): void;
  pauseSession(): void;
  endSession(): void;
  recordActivity(h: Heartbeat): void;
  getProjectStats(range: DateRange): ProjectStat[];
  getLanguageStats(range: DateRange): LanguageStat[];
  getDailyStats(range: DateRange): DailyStat[];
  getSessions(range: DateRange): Session[];
  getIntervals(range: DateRange): Interval[];
  readonly onDidChange: Event<void>;
}
