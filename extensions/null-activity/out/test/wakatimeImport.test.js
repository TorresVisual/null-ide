'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const projectIdentity_1 = require("../projectIdentity");
const wakatimeImport_1 = require("../wakatimeImport");
const T0 = Date.UTC(2025, 3, 10, 12, 0, 0) / 1000; // seconds, like the export
const hb = (offsetSec, over = {}) => ({
    time: T0 + offsetSec,
    project: 'proj',
    language: 'TypeScript',
    entity: 'C:\\code\\proj\\src\\a.ts',
    type: 'file',
    ...over,
});
const exportOf = (beats, timeout) => ({
    user: timeout === undefined ? {} : { timeout },
    range: {},
    days: [{ date: '2025-04-10', heartbeats: beats }],
});
const noResolve = () => undefined;
const ms = (offsetSec) => (T0 + offsetSec) * 1000;
(0, node_test_1.test)('a gap equal to the timeout counts, one second more does not', () => {
    const at = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(15 * 60)], 15), noResolve).intervals;
    node_assert_1.default.deepStrictEqual(at.map((i) => [i.start, i.end]), [[ms(0), ms(15 * 60)]]);
    node_assert_1.default.deepStrictEqual((0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(15 * 60 + 1)], 15), noResolve).intervals, []);
});
(0, node_test_1.test)('consecutive heartbeats with the same project, language and file merge into one interval', () => {
    const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60), hb(120)]), noResolve);
    node_assert_1.default.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(120)]]);
    node_assert_1.default.deepStrictEqual({ project: intervals[0].project, language: intervals[0].language, file: intervals[0].file, a: intervals[0].linesAdded, r: intervals[0].linesRemoved }, { project: { key: 'proj', name: 'proj' }, language: 'typescript', file: 'a.ts', a: 0, r: 0 });
});
(0, node_test_1.test)('a change of file, project or language starts a new interval', () => {
    for (const over of [{ entity: 'C:\\code\\proj\\src\\b.ts' }, { project: 'other' }, { language: 'Python' }]) {
        const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60, over), hb(120, over)]), noResolve);
        node_assert_1.default.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)], [ms(60), ms(120)]], JSON.stringify(over));
    }
});
(0, node_test_1.test)('the last heartbeat of a streak counts nothing', () => {
    const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60), hb(10_000)]), noResolve);
    node_assert_1.default.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});
(0, node_test_1.test)('heartbeats at the same instant (two machines) do not double-count or create empty intervals', () => {
    const b = { entity: 'C:\\code\\proj\\src\\b.ts' };
    const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(0, b), hb(60, b)]), noResolve);
    node_assert_1.default.deepStrictEqual(intervals.map((i) => [i.start, i.end, i.file]), [[ms(0), ms(60), 'b.ts']]);
});
(0, node_test_1.test)('unsorted input is sorted by time', () => {
    const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(60), hb(0)]), noResolve);
    node_assert_1.default.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});
(0, node_test_1.test)('malformed heartbeats are skipped and counted', () => {
    const { intervals, summary } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), { project: 'x' }, { time: 'abc' }, null, hb(60)]), noResolve);
    node_assert_1.default.strictEqual(intervals.length, 1);
    node_assert_1.default.strictEqual(summary.heartbeats, 5);
    node_assert_1.default.strictEqual(summary.skipped, 3);
});
(0, node_test_1.test)('app heartbeats go to (no folder) with no language and no file', () => {
    const app = (s) => ({ time: T0 + s, type: 'app', project: 'Figma', language: '', entity: 'Figma' });
    const { intervals, summary } = (0, wakatimeImport_1.convertExport)(exportOf([app(0), app(60)]), noResolve);
    node_assert_1.default.strictEqual(intervals.length, 1);
    node_assert_1.default.deepStrictEqual(intervals[0].project, { key: projectIdentity_1.NO_FOLDER, name: projectIdentity_1.NO_FOLDER });
    node_assert_1.default.strictEqual(intervals[0].language, '');
    node_assert_1.default.strictEqual('file' in intervals[0], false);
    node_assert_1.default.strictEqual(summary.appHeartbeats, 2);
    node_assert_1.default.strictEqual(summary.projectsByName, 0);
});
(0, node_test_1.test)('a heartbeat with no project name is (no folder) but keeps its file name', () => {
    const { intervals } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0, { project: '' }), hb(60, { project: '' })]), noResolve);
    node_assert_1.default.deepStrictEqual(intervals[0].project, { key: projectIdentity_1.NO_FOLDER, name: projectIdentity_1.NO_FOLDER });
    node_assert_1.default.strictEqual(intervals[0].file, 'a.ts');
});
(0, node_test_1.test)('a resolved project supplies the key, and files are relative to its root (case-insensitive) else the basename', () => {
    const seen = [];
    const resolve = (name, dir) => {
        seen.push([name, dir]);
        return { key: 'github.com/o/r', name: 'r', root: 'C:\\code\\proj' };
    };
    const { intervals, summary } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60, { entity: 'c:\\CODE\\proj\\src\\b.ts' }), hb(120, { entity: 'D:\\elsewhere\\c.ts' }), hb(180)]), resolve);
    node_assert_1.default.deepStrictEqual(seen, [['proj', 'C:/code/proj/src']], 'resolver gets the most common directory, once');
    node_assert_1.default.deepStrictEqual(intervals.map((i) => i.file), ['src/a.ts', 'src/b.ts', 'c.ts']);
    node_assert_1.default.ok(intervals.every((i) => i.project.key === 'github.com/o/r' && i.project.name === 'r'));
    node_assert_1.default.strictEqual(summary.projectsResolved, 1);
    node_assert_1.default.strictEqual(summary.projectsByName, 0);
});
(0, node_test_1.test)('an unresolved or throwing resolver keeps the WakaTime name and the basename', () => {
    for (const resolve of [noResolve, (() => { throw new Error('boom'); })]) {
        const { intervals, summary } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60)]), resolve);
        node_assert_1.default.deepStrictEqual(intervals[0].project, { key: 'proj', name: 'proj' });
        node_assert_1.default.strictEqual(intervals[0].file, 'a.ts');
        node_assert_1.default.strictEqual(summary.projectsByName, 1);
    }
});
(0, node_test_1.test)('POSIX and relative entities work and no absolute path or profile data reaches the output', () => {
    const data = exportOf([hb(0, { entity: '/home/me/proj/x.rs' }), hb(60, { entity: 'rel/dir/y.rs' }), hb(120, { entity: 'C:\\Users\\me\\z.rs' }), hb(180)], 15);
    data.user.email = 'me@example.com';
    const json = JSON.stringify((0, wakatimeImport_1.convertExport)(data, noResolve).intervals);
    node_assert_1.default.ok(!json.includes('me@example.com'));
    node_assert_1.default.ok(!json.includes('C:'));
    node_assert_1.default.ok(!json.includes('/home'));
    node_assert_1.default.ok(!json.includes('\\'));
    node_assert_1.default.deepStrictEqual((0, wakatimeImport_1.convertExport)(data, noResolve).intervals.map((i) => i.file), ['x.rs', 'y.rs', 'z.rs']);
});
(0, node_test_1.test)('the timeout comes from user.timeout and falls back to 15 minutes', () => {
    node_assert_1.default.deepStrictEqual((0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(6 * 60)], 5), noResolve).intervals, []);
    node_assert_1.default.strictEqual((0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(6 * 60)], 5), noResolve).summary.timeoutMs, 5 * 60_000);
    for (const t of [undefined, 0, -3, NaN]) {
        const r = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(14 * 60)], t), noResolve);
        node_assert_1.default.strictEqual(r.summary.timeoutMs, 15 * 60_000, String(t));
        node_assert_1.default.strictEqual(r.intervals.length, 1, String(t));
    }
});
(0, node_test_1.test)('the summary counts days and total time', () => {
    const day = 86_400;
    const { summary } = (0, wakatimeImport_1.convertExport)(exportOf([hb(0), hb(60), hb(2 * day), hb(2 * day + 120)]), noResolve);
    node_assert_1.default.strictEqual(summary.days, 2);
    node_assert_1.default.strictEqual(summary.totalMs, 3 * 60_000);
});
(0, node_test_1.test)('not-an-export input throws and a day without heartbeats is ignored', () => {
    for (const bad of [null, 42, {}, { days: 'x' }])
        node_assert_1.default.throws(() => (0, wakatimeImport_1.convertExport)(bad, noResolve), /Not a WakaTime export/);
    node_assert_1.default.deepStrictEqual((0, wakatimeImport_1.convertExport)({ days: [{ date: '2025-01-01' }, null] }, noResolve).intervals, []);
});
(0, node_test_1.test)('100k heartbeats convert without blowing up', () => {
    const many = Array.from({ length: 100_000 }, (_, i) => hb(i * 30, { entity: `C:\\code\\proj\\src\\f${i % 7}.ts` }));
    const { intervals, summary } = (0, wakatimeImport_1.convertExport)(exportOf(many), noResolve);
    node_assert_1.default.strictEqual(summary.heartbeats, 100_000);
    node_assert_1.default.strictEqual(intervals.length, 99_999);
    node_assert_1.default.strictEqual(summary.totalMs, 99_999 * 30_000);
});
(0, node_test_1.test)('formatSummary reports hours, projects, skips and the gap rule', () => {
    const text = (0, wakatimeImport_1.formatSummary)({
        days: 288, totalMs: 90 * 3_600_000, heartbeats: 1000, skipped: 2, appHeartbeats: 5,
        projectsResolved: 40, projectsByName: 153, timeoutMs: 15 * 60_000,
    });
    for (const part of ['90.0 h', '288 days', '40 matched to local repos', '153 kept by WakaTime name', '5 app', 'Skipped 2', '15 min']) {
        node_assert_1.default.ok(text.includes(part), `${part} in: ${text}`);
    }
});
//# sourceMappingURL=wakatimeImport.test.js.map