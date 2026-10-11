'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  DashboardSource, MAX_SESSIONS, TERMINAL_LABEL, buildDashboardModel, hourlyStats, isDashboardRange, parseWebviewMessage, rangeFor,
} from '../dashboardModel';
import { ALL_TIME, languageStats, normalizeIntervals, periodStats, projectStats, sessions } from '../stats';
import { Interval } from '../types';

// Set after the imports and before any Date is used: boundaries and DST are then the same on every machine.
process.env.TZ = 'Europe/Vienna';
const tzApplied = { skip: new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset() !== -120 && 'process.env.TZ is not honoured here' };

const MIN = 60_000;
const HOUR = 3_600_000;
/** Local time; month is zero-based and defaults to October 2026 (Thu 8 Oct 2026). */
const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const NOW = at(8, 15);
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
/** The same derivations ActivityService performs, minus the store. */
const source = (intervals: Interval[], gapMs = 15 * MIN): DashboardSource => ({
  getIntervals: (r) => normalizeIntervals(intervals, r),
  getProjectStats: (r) => projectStats(intervals, r),
  getLanguageStats: (r) => languageStats(intervals, r),
  getDailyStats: (r) => periodStats(intervals, r, 'day'),
  getSessions: (r) => sessions(intervals, r, gapMs),
});
const build = (intervals: Interval[], range: DashboardRange, now = NOW, enabled = true) =>
  buildDashboardModel(source(intervals), range, now, enabled);
const sum = (bars: { ms: number }[]) => bars.reduce((n, b) => n + b.ms, 0);

test('rangeFor: Monday week start, month end, yesterday and all time', () => {
  assert.deepStrictEqual(rangeFor('today', NOW), { from: at(8, 0), to: at(9, 0) });
  assert.deepStrictEqual(rangeFor('yesterday', NOW), { from: at(7, 0), to: at(8, 0) });
  assert.deepStrictEqual(rangeFor('week', NOW), { from: at(5, 0), to: at(12, 0) });
  assert.deepStrictEqual(rangeFor('week', at(11, 23, 59)), { from: at(5, 0), to: at(12, 0) }); // Sunday belongs to the week that began Monday
  assert.deepStrictEqual(rangeFor('month', NOW), { from: at(1, 0), to: at(1, 0, 0, 10) });
  assert.deepStrictEqual(rangeFor('all', NOW), ALL_TIME);
});

test('range labels', () => {
  assert.strictEqual(build([], 'today').rangeLabel, 'Today');
  assert.strictEqual(build([], 'yesterday').rangeLabel, 'Yesterday');
  assert.strictEqual(build([], 'week').rangeLabel, 'Mon 5 – Sun 11 Oct');
  assert.strictEqual(build([], 'week', at(30, 12, 0, 8)).rangeLabel, 'Mon 28 Sep – Sun 4 Oct');
  assert.strictEqual(build([], 'month').rangeLabel, 'October 2026');
  assert.strictEqual(build([], 'all').rangeLabel, 'All time');
});

test('an interval across midnight is split between the two days (hourly bars)', () => {
  const data = [iv(at(7, 23, 30), at(8, 0, 30))];
  const today = build(data, 'today');
  const yesterday = build(data, 'yesterday');
  assert.strictEqual(today.barUnit, 'hour');
  assert.strictEqual(today.bars.length, 24);
  assert.strictEqual(today.bars[0].ms, 30 * MIN);
  assert.strictEqual(today.bars[0].label, '00:00');
  assert.strictEqual(today.bars[0].startMs, at(8, 0));
  assert.strictEqual(today.totalMs, 30 * MIN);
  assert.strictEqual(yesterday.bars[23].ms, 30 * MIN);
  assert.strictEqual(yesterday.bars[23].startMs, at(7, 23));
  assert.strictEqual(yesterday.totalMs, 30 * MIN);
});

test('fall-back day: 25 hours, the repeated hour is merged into one bar, bars sum to the total', tzApplied, () => {
  const day = rangeFor('today', Date.UTC(2026, 9, 25, 12)); // Sun 25 Oct 2026, 03:00 CEST -> 02:00 CET
  assert.strictEqual(day.to - day.from, 25 * HOUR);
  const out = hourlyStats([iv(day.from, day.to)], day);
  assert.strictEqual(out.length, 24);
  assert.strictEqual(out[2], 2 * HOUR);
  assert.ok(out.filter((_, i) => i !== 2).every((ms) => ms === HOUR));
  assert.strictEqual(out.reduce((n, ms) => n + ms, 0), 25 * HOUR);
  const model = build([iv(day.from, day.to)], 'today', Date.UTC(2026, 9, 25, 12));
  assert.strictEqual(sum(model.bars), model.totalMs);
  assert.strictEqual(model.totalMs, 25 * HOUR);
});

test('spring-forward day: 23 hours, the missing hour is an empty bar, bars sum to the total', tzApplied, () => {
  const day = rangeFor('today', Date.UTC(2026, 2, 29, 12)); // Sun 29 Mar 2026, 02:00 CET -> 03:00 CEST
  assert.strictEqual(day.to - day.from, 23 * HOUR);
  const out = hourlyStats([iv(day.from, day.to)], day);
  assert.strictEqual(out[2], 0);
  assert.strictEqual(out.reduce((n, ms) => n + ms, 0), 23 * HOUR);
});

test('overlapping windows are not double-counted', () => {
  const data = [iv(at(8, 10), at(8, 10, 10)), iv(at(8, 10, 5), at(8, 10, 15), { project: { key: 'k2', name: 'other' } })];
  const model = build(data, 'today');
  assert.strictEqual(model.totalMs, 15 * MIN);
  assert.strictEqual(sum(model.bars), 15 * MIN);
  assert.strictEqual(model.bars[10].ms, 15 * MIN);
  assert.deepStrictEqual(model.projects.map((p) => [p.name, p.ms, p.percent]), [['proj', 10 * MIN, 67], ['other', 5 * MIN, 33]]);
});

test('more than eight projects: top seven stay, the rest fold into "Other"; percents add up', () => {
  const data = Array.from({ length: 9 }, (_, n) =>
    iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
  const { projects } = build(data, 'today');
  assert.strictEqual(projects.length, 8);
  assert.strictEqual(projects[7].name, 'Other');
  assert.strictEqual(projects[7].ms, 20 * MIN);
  assert.deepStrictEqual(projects.map((p) => p.percent), [11, 11, 11, 11, 11, 11, 11, 22]);
});

test('exactly eight projects are all shown without "Other"', () => {
  const data = Array.from({ length: 8 }, (_, n) =>
    iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
  const { projects } = build(data, 'today');
  assert.strictEqual(projects.length, 8);
  assert.ok(projects.every((p) => p.name !== 'Other'));
});

test('the empty language is labelled "Terminal / other"', () => {
  const { languages } = build([iv(at(8, 9), at(8, 9, 30), { language: '', file: undefined })], 'today');
  assert.deepStrictEqual(languages.map((l) => l.name), [TERMINAL_LABEL]);
});

test('an empty range has zeroed bars and no lists', () => {
  const week = build([], 'week');
  assert.strictEqual(week.totalMs, 0);
  assert.strictEqual(week.bars.length, 7);
  assert.ok(week.bars.every((b) => b.ms === 0));
  assert.deepStrictEqual([week.projects, week.languages, week.sessions], [[], [], []]);
  assert.deepStrictEqual(build([], 'all').bars, []);
});

test('week and month use one bar per local day, zero-filled', () => {
  const data = [iv(at(7, 10), at(7, 10, 30))]; // Wed 7 Oct
  const week = build(data, 'week');
  assert.strictEqual(week.barUnit, 'day');
  assert.strictEqual(week.bars.length, 7);
  assert.strictEqual(week.bars[0].startMs, at(5, 0));
  assert.strictEqual(week.bars[0].label, 'Mon 5 Oct');
  assert.strictEqual(week.bars[2].ms, 30 * MIN);
  assert.strictEqual(sum(week.bars), week.totalMs);
  const month = build(data, 'month');
  assert.strictEqual(month.bars.length, 31);
  assert.strictEqual(month.bars[6].ms, 30 * MIN);
});

test('all time: one bar per month from the first recorded month, gaps filled', () => {
  const data = [iv(at(20, 10, 0, 7), at(20, 11, 0, 7)), iv(at(8, 10), at(8, 11))]; // 20 Aug and 8 Oct
  const model = build(data, 'all');
  assert.strictEqual(model.barUnit, 'month');
  assert.deepStrictEqual(model.bars.map((b) => [b.label, b.ms]), [['Aug 2026', HOUR], ['Sep 2026', 0], ['Oct 2026', HOUR]]);
});

test('two years of history under "all time" keep one bar per month and the right total', () => {
  const data = Array.from({ length: 24 }, (_, k) => {
    const start = new Date(2024, 10 + k, 15, 10).getTime(); // Nov 2024 .. Oct 2026
    return iv(start, start + HOUR);
  });
  const model = build(data, 'all');
  assert.strictEqual(model.bars.length, 24);
  assert.ok(model.bars.every((b) => b.ms === HOUR));
  assert.strictEqual(model.totalMs, 24 * HOUR);
  assert.strictEqual(sum(model.bars), model.totalMs);
});

test('sessions are newest first and capped', () => {
  const data = Array.from({ length: 60 }, (_, n) => iv(at(1, 0) + n * HOUR, at(1, 0) + n * HOUR + MIN));
  const model = build(data, 'month');
  assert.strictEqual(model.sessions.length, MAX_SESSIONS);
  assert.strictEqual(model.sessions[0].start, at(1, 0) + 59 * HOUR);
  assert.strictEqual(model.sessions[MAX_SESSIONS - 1].start, at(1, 0) + 10 * HOUR);
  assert.ok(model.sessions.every((s, i, all) => i === 0 || s.start < all[i - 1].start));
  assert.deepStrictEqual(model.sessions[0], {
    start: at(1, 0) + 59 * HOUR, end: at(1, 0) + 59 * HOUR + MIN, ms: MIN, projects: ['proj'], languages: ['typescript'], files: ['a.ts'],
  });
});

test('the enabled flag is passed through and existing data is still shown', () => {
  const model = build([iv(at(8, 9), at(8, 9, 30))], 'today', NOW, false);
  assert.strictEqual(model.enabled, false);
  assert.strictEqual(model.totalMs, 30 * MIN);
});

test('isDashboardRange accepts only the five presets', () => {
  for (const r of ['today', 'yesterday', 'week', 'month', 'all']) assert.ok(isDashboardRange(r));
  for (const r of ['custom', '', 'TODAY', null, undefined, 3, {}]) assert.ok(!isDashboardRange(r));
});

test('parseWebviewMessage keeps valid intents, strips extra fields and ignores everything else', () => {
  for (const type of ['ready', 'enableTracking', 'showTrackedData', 'openSettings']) {
    assert.deepStrictEqual(parseWebviewMessage({ type, evil: 1 }), { type });
  }
  assert.deepStrictEqual(parseWebviewMessage({ type: 'setRange', range: 'week' }), { type: 'setRange', range: 'week' });
  for (const bad of [
    { type: 'setRange' }, { type: 'setRange', range: 'custom' }, { type: 'setRange', range: 7 }, { type: 'delete' }, { type: 3 },
    {}, null, undefined, 'ready', 42, [],
  ]) {
    assert.strictEqual(parseWebviewMessage(bad), undefined);
  }
});

test('git is passed through; only project rows carry a key, never "Other"', () => {
  const git = {
    totals: { commits: 1, filesChanged: 1, linesAdded: 2, linesRemoved: 3 },
    byProject: { k0: { commits: 1, filesChanged: 1, linesAdded: 2, linesRemoved: 3 } },
  };
  const data = Array.from({ length: 9 }, (_, i) => iv(at(8, 1 + i), at(8, 1 + i, 30), { project: { key: `k${i}`, name: `p${i}` } }));
  const model = buildDashboardModel(source(data), 'today', NOW, true, git);
  assert.strictEqual(model.git, git);
  assert.strictEqual(model.projects[7].name, 'Other');
  assert.strictEqual(model.projects[7].key, undefined);
  assert.ok(model.projects.slice(0, 7).every((p) => /^k\d$/.test(p.key ?? '')));
  assert.ok(model.languages.every((l) => l.key === undefined));
});

test('without git data the model has no git field', () => {
  assert.ok(!('git' in build([iv(at(8, 10), at(8, 11))], 'today')));
});

test('parallel windows: the total is the union, the shares are relative to the summed project time', () => {
  const data = ['a', 'b', 'c'].map((w) => iv(at(8, 10), at(8, 10, 10), { window: w, project: { key: w, name: w } }));
  const model = build(data, 'today');
  assert.strictEqual(model.totalMs, 10 * MIN);
  assert.strictEqual(sum(model.bars), 10 * MIN);
  assert.deepStrictEqual(model.projects.map((p) => [p.ms, p.percent]), [[10 * MIN, 33], [10 * MIN, 33], [10 * MIN, 33]]);
  assert.deepStrictEqual(model.sessions.map((s) => [s.ms, s.projects]), [[10 * MIN, ['a', 'b', 'c']]]);
});
