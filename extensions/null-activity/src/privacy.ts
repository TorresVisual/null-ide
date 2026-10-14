'use strict';

import { dayRange, formatDuration, lastDaysRange, monthRange, nextPeriodStart } from './stats';
import { DailyStat, DateRange } from './types';

export type RangeChoice = 'today' | 'last7' | 'month';

export function choiceRange(choice: RangeChoice, now: number): DateRange {
  if (choice === 'today') return dayRange(now);
  if (choice === 'last7') return lastDaysRange(now, 7);
  return monthRange(now);
}

/** Local midnight of a real `YYYY-MM-DD` date, otherwise undefined. */
export function parseDay(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : undefined;
}

/** `to` is an inclusive day. */
export function customRange(fromText: string, toText: string): DateRange | undefined {
  const from = parseDay(fromText);
  const toDay = parseDay(toText);
  if (from === undefined || toDay === undefined || toDay < from) return undefined;
  return { from, to: nextPeriodStart(toDay, 'day') };
}

export function trackedDataReport(info: { storageDir: string; enabled: boolean; months: DailyStat[] }): string {
  const totals = info.months.length
    ? info.months.map((m) => `  ${m.day.slice(0, 7)}  ${formatDuration(m.ms)}`).join('\n')
    : '  (no data yet)';
  return [
    'Null Activity — tracked data',
    '',
    'Recorded for each stretch of activity:',
    '  start and end time, project (git remote URL, or folder path when there is no remote,',
    '  plus the folder name), language, file (path relative to the workspace), git branch,',
    '  lines added and removed.',
    '',
    'Never recorded: file contents, diffs, or source text.',
    'Nothing leaves this machine unless you publish badges (only total time, daily average and top language, to a secret GitHub Gist)',
    'or turn on activity sync ("Null: Choose What to Sync"), which uploads all of the above to a secret Gist, encrypted with your sync passphrase.',
    '',
    `Storage: ${info.storageDir}`,
    `Tracking: ${info.enabled ? 'on' : 'off'} (setting null-activity.enabled)`,
    '',
    'Totals by month:',
    totals,
    '',
    'Delete data with "Null Activity: Delete Tracked Data for a Range…" or "Null Activity: Delete All Tracked Data…".',
    '',
  ].join('\n');
}
