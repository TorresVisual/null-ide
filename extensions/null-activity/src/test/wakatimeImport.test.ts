'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { NO_FOLDER } from '../projectIdentity';
import { convertExport, formatSummary, WakaProjectResolver } from '../wakatimeImport';

const T0 = Date.UTC(2025, 3, 10, 12, 0, 0) / 1000; // seconds, like the export
const hb = (offsetSec: number, over: Record<string, unknown> = {}) => ({
  time: T0 + offsetSec,
  project: 'proj',
  language: 'TypeScript',
  entity: 'C:\\code\\proj\\src\\a.ts',
  type: 'file',
  ...over,
});
const exportOf = (beats: unknown[], timeout?: number) => ({
  user: timeout === undefined ? {} : { timeout },
  range: {},
  days: [{ date: '2025-04-10', heartbeats: beats }],
});
const noResolve: WakaProjectResolver = () => undefined;
const ms = (offsetSec: number) => (T0 + offsetSec) * 1000;

test('a gap equal to the timeout counts, one second more does not', () => {
  const at = convertExport(exportOf([hb(0), hb(15 * 60)], 15), noResolve).intervals;
  assert.deepStrictEqual(at.map((i) => [i.start, i.end]), [[ms(0), ms(15 * 60)]]);
  assert.deepStrictEqual(convertExport(exportOf([hb(0), hb(15 * 60 + 1)], 15), noResolve).intervals, []);
});

test('consecutive heartbeats with the same project, language and file merge into one interval', () => {
  const { intervals } = convertExport(exportOf([hb(0), hb(60), hb(120)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(120)]]);
  assert.deepStrictEqual(
    { project: intervals[0].project, language: intervals[0].language, file: intervals[0].file, a: intervals[0].linesAdded, r: intervals[0].linesRemoved },
    { project: { key: 'proj', name: 'proj' }, language: 'typescript', file: 'a.ts', a: 0, r: 0 },
  );
});

test('a change of file, project or language starts a new interval', () => {
  for (const over of [{ entity: 'C:\\code\\proj\\src\\b.ts' }, { project: 'other' }, { language: 'Python' }]) {
    const { intervals } = convertExport(exportOf([hb(0), hb(60, over), hb(120, over)]), noResolve);
    assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)], [ms(60), ms(120)]], JSON.stringify(over));
  }
});

test('the last heartbeat of a streak counts nothing', () => {
  const { intervals } = convertExport(exportOf([hb(0), hb(60), hb(10_000)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});

test('heartbeats at the same instant (two machines) do not double-count or create empty intervals', () => {
  const b = { entity: 'C:\\code\\proj\\src\\b.ts' };
  const { intervals } = convertExport(exportOf([hb(0), hb(0, b), hb(60, b)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end, i.file]), [[ms(0), ms(60), 'b.ts']]);
});

test('unsorted input is sorted by time', () => {
  const { intervals } = convertExport(exportOf([hb(60), hb(0)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});

test('malformed heartbeats are skipped and counted', () => {
  const { intervals, summary } = convertExport(exportOf([hb(0), { project: 'x' }, { time: 'abc' }, null, hb(60)]), noResolve);
  assert.strictEqual(intervals.length, 1);
  assert.strictEqual(summary.heartbeats, 5);
  assert.strictEqual(summary.skipped, 3);
});

test('app heartbeats go to (no folder) with no language and no file', () => {
  const app = (s: number) => ({ time: T0 + s, type: 'app', project: 'Figma', language: '', entity: 'Figma' });
  const { intervals, summary } = convertExport(exportOf([app(0), app(60)]), noResolve);
  assert.strictEqual(intervals.length, 1);
  assert.deepStrictEqual(intervals[0].project, { key: NO_FOLDER, name: NO_FOLDER });
  assert.strictEqual(intervals[0].language, '');
  assert.strictEqual('file' in intervals[0], false);
  assert.strictEqual(summary.appHeartbeats, 2);
  assert.strictEqual(summary.projectsByName, 0);
});

test('a heartbeat with no project name is (no folder) but keeps its file name', () => {
  const { intervals } = convertExport(exportOf([hb(0, { project: '' }), hb(60, { project: '' })]), noResolve);
  assert.deepStrictEqual(intervals[0].project, { key: NO_FOLDER, name: NO_FOLDER });
  assert.strictEqual(intervals[0].file, 'a.ts');
});

test('a resolved project supplies the key, and files are relative to its root (case-insensitive) else the basename', () => {
  const seen: Array<[string, string]> = [];
  const resolve: WakaProjectResolver = (name, dir) => {
    seen.push([name, dir]);
    return { key: 'github.com/o/r', name: 'r', root: 'C:\\code\\proj' };
  };
  const { intervals, summary } = convertExport(
    exportOf([hb(0), hb(60, { entity: 'c:\\CODE\\proj\\src\\b.ts' }), hb(120, { entity: 'D:\\elsewhere\\c.ts' }), hb(180)]),
    resolve,
  );
  assert.deepStrictEqual(seen, [['proj', 'C:/code/proj/src']], 'resolver gets the most common directory, once');
  assert.deepStrictEqual(intervals.map((i) => i.file), ['src/a.ts', 'src/b.ts', 'c.ts']);
  assert.ok(intervals.every((i) => i.project.key === 'github.com/o/r' && i.project.name === 'r'));
  assert.strictEqual(summary.projectsResolved, 1);
  assert.strictEqual(summary.projectsByName, 0);
});

test('an unresolved or throwing resolver keeps the WakaTime name and the basename', () => {
  for (const resolve of [noResolve, (() => { throw new Error('boom'); }) as WakaProjectResolver]) {
    const { intervals, summary } = convertExport(exportOf([hb(0), hb(60)]), resolve);
    assert.deepStrictEqual(intervals[0].project, { key: 'proj', name: 'proj' });
    assert.strictEqual(intervals[0].file, 'a.ts');
    assert.strictEqual(summary.projectsByName, 1);
  }
});

test('POSIX and relative entities work and no absolute path or profile data reaches the output', () => {
  const data = exportOf(
    [hb(0, { entity: '/home/me/proj/x.rs' }), hb(60, { entity: 'rel/dir/y.rs' }), hb(120, { entity: 'C:\\Users\\me\\z.rs' }), hb(180)],
    15,
  );
  (data.user as Record<string, unknown>).email = 'me@example.com';
  const json = JSON.stringify(convertExport(data, noResolve).intervals);
  assert.ok(!json.includes('me@example.com'));
  assert.ok(!json.includes('C:'));
  assert.ok(!json.includes('/home'));
  assert.ok(!json.includes('\\'));
  assert.deepStrictEqual(convertExport(data, noResolve).intervals.map((i) => i.file), ['x.rs', 'y.rs', 'z.rs']);
});

test('the timeout comes from user.timeout and falls back to 15 minutes', () => {
  assert.deepStrictEqual(convertExport(exportOf([hb(0), hb(6 * 60)], 5), noResolve).intervals, []);
  assert.strictEqual(convertExport(exportOf([hb(0), hb(6 * 60)], 5), noResolve).summary.timeoutMs, 5 * 60_000);
  for (const t of [undefined, 0, -3, NaN]) {
    const r = convertExport(exportOf([hb(0), hb(14 * 60)], t as number | undefined), noResolve);
    assert.strictEqual(r.summary.timeoutMs, 15 * 60_000, String(t));
    assert.strictEqual(r.intervals.length, 1, String(t));
  }
});

test('the summary counts days and total time', () => {
  const day = 86_400;
  const { summary } = convertExport(exportOf([hb(0), hb(60), hb(2 * day), hb(2 * day + 120)]), noResolve);
  assert.strictEqual(summary.days, 2);
  assert.strictEqual(summary.totalMs, 3 * 60_000);
});

test('not-an-export input throws and a day without heartbeats is ignored', () => {
  for (const bad of [null, 42, {}, { days: 'x' }]) assert.throws(() => convertExport(bad, noResolve), /Not a WakaTime export/);
  assert.deepStrictEqual(convertExport({ days: [{ date: '2025-01-01' }, null] }, noResolve).intervals, []);
});

test('100k heartbeats convert without blowing up', () => {
  const many = Array.from({ length: 100_000 }, (_, i) => hb(i * 30, { entity: `C:\\code\\proj\\src\\f${i % 7}.ts` }));
  const { intervals, summary } = convertExport(exportOf(many), noResolve);
  assert.strictEqual(summary.heartbeats, 100_000);
  assert.strictEqual(intervals.length, 99_999);
  assert.strictEqual(summary.totalMs, 99_999 * 30_000);
});

test('formatSummary reports hours, projects, skips and the gap rule', () => {
  const text = formatSummary({
    days: 288, totalMs: 90 * 3_600_000, heartbeats: 1000, skipped: 2, appHeartbeats: 5,
    projectsResolved: 40, projectsByName: 153, timeoutMs: 15 * 60_000,
  });
  for (const part of ['90.0 h', '288 days', '40 matched to local repos', '153 kept by WakaTime name', '5 app', 'Skipped 2', '15 min']) {
    assert.ok(text.includes(part), `${part} in: ${text}`);
  }
});
