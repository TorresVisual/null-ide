'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const dashboardModel_1 = require("../dashboardModel");
const stats_1 = require("../stats");
// Set after the imports and before any Date is used: boundaries and DST are then the same on every machine.
process.env.TZ = 'Europe/Vienna';
const tzApplied = { skip: new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset() !== -120 && 'process.env.TZ is not honoured here' };
const MIN = 60_000;
const HOUR = 3_600_000;
/** Local time; month is zero-based and defaults to October 2026 (Thu 8 Oct 2026). */
const at = (day, h, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const NOW = at(8, 15);
const iv = (start, end, over = {}) => ({
    start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
/** The same derivations ActivityService performs, minus the store. */
const source = (intervals, gapMs = 15 * MIN) => ({
    getIntervals: (r) => (0, stats_1.normalizeIntervals)(intervals, r),
    getProjectStats: (r) => (0, stats_1.projectStats)(intervals, r),
    getLanguageStats: (r) => (0, stats_1.languageStats)(intervals, r),
    getDailyStats: (r) => (0, stats_1.periodStats)(intervals, r, 'day'),
    getSessions: (r) => (0, stats_1.sessions)(intervals, r, gapMs),
});
const build = (intervals, range, now = NOW, enabled = true) => (0, dashboardModel_1.buildDashboardModel)(source(intervals), range, now, enabled);
const sum = (bars) => bars.reduce((n, b) => n + b.ms, 0);
(0, node_test_1.test)('rangeFor: Monday week start, month end, yesterday and all time', () => {
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('today', NOW), { from: at(8, 0), to: at(9, 0) });
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('yesterday', NOW), { from: at(7, 0), to: at(8, 0) });
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('week', NOW), { from: at(5, 0), to: at(12, 0) });
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('week', at(11, 23, 59)), { from: at(5, 0), to: at(12, 0) }); // Sunday belongs to the week that began Monday
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('month', NOW), { from: at(1, 0), to: at(1, 0, 0, 10) });
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.rangeFor)('all', NOW), stats_1.ALL_TIME);
});
(0, node_test_1.test)('range labels', () => {
    node_assert_1.default.strictEqual(build([], 'today').rangeLabel, 'Today');
    node_assert_1.default.strictEqual(build([], 'yesterday').rangeLabel, 'Yesterday');
    node_assert_1.default.strictEqual(build([], 'week').rangeLabel, 'Mon 5 – Sun 11 Oct');
    node_assert_1.default.strictEqual(build([], 'week', at(30, 12, 0, 8)).rangeLabel, 'Mon 28 Sep – Sun 4 Oct');
    node_assert_1.default.strictEqual(build([], 'month').rangeLabel, 'October 2026');
    node_assert_1.default.strictEqual(build([], 'all').rangeLabel, 'All time');
});
(0, node_test_1.test)('an interval across midnight is split between the two days (hourly bars)', () => {
    const data = [iv(at(7, 23, 30), at(8, 0, 30))];
    const today = build(data, 'today');
    const yesterday = build(data, 'yesterday');
    node_assert_1.default.strictEqual(today.barUnit, 'hour');
    node_assert_1.default.strictEqual(today.bars.length, 24);
    node_assert_1.default.strictEqual(today.bars[0].ms, 30 * MIN);
    node_assert_1.default.strictEqual(today.bars[0].label, '00:00');
    node_assert_1.default.strictEqual(today.bars[0].startMs, at(8, 0));
    node_assert_1.default.strictEqual(today.totalMs, 30 * MIN);
    node_assert_1.default.strictEqual(yesterday.bars[23].ms, 30 * MIN);
    node_assert_1.default.strictEqual(yesterday.bars[23].startMs, at(7, 23));
    node_assert_1.default.strictEqual(yesterday.totalMs, 30 * MIN);
});
(0, node_test_1.test)('fall-back day: 25 hours, the repeated hour is merged into one bar, bars sum to the total', tzApplied, () => {
    const day = (0, dashboardModel_1.rangeFor)('today', Date.UTC(2026, 9, 25, 12)); // Sun 25 Oct 2026, 03:00 CEST -> 02:00 CET
    node_assert_1.default.strictEqual(day.to - day.from, 25 * HOUR);
    const out = (0, dashboardModel_1.hourlyStats)([iv(day.from, day.to)], day);
    node_assert_1.default.strictEqual(out.length, 24);
    node_assert_1.default.strictEqual(out[2], 2 * HOUR);
    node_assert_1.default.ok(out.filter((_, i) => i !== 2).every((ms) => ms === HOUR));
    node_assert_1.default.strictEqual(out.reduce((n, ms) => n + ms, 0), 25 * HOUR);
    const model = build([iv(day.from, day.to)], 'today', Date.UTC(2026, 9, 25, 12));
    node_assert_1.default.strictEqual(sum(model.bars), model.totalMs);
    node_assert_1.default.strictEqual(model.totalMs, 25 * HOUR);
});
(0, node_test_1.test)('spring-forward day: 23 hours, the missing hour is an empty bar, bars sum to the total', tzApplied, () => {
    const day = (0, dashboardModel_1.rangeFor)('today', Date.UTC(2026, 2, 29, 12)); // Sun 29 Mar 2026, 02:00 CET -> 03:00 CEST
    node_assert_1.default.strictEqual(day.to - day.from, 23 * HOUR);
    const out = (0, dashboardModel_1.hourlyStats)([iv(day.from, day.to)], day);
    node_assert_1.default.strictEqual(out[2], 0);
    node_assert_1.default.strictEqual(out.reduce((n, ms) => n + ms, 0), 23 * HOUR);
});
(0, node_test_1.test)('overlapping windows are not double-counted', () => {
    const data = [iv(at(8, 10), at(8, 10, 10)), iv(at(8, 10, 5), at(8, 10, 15), { project: { key: 'k2', name: 'other' } })];
    const model = build(data, 'today');
    node_assert_1.default.strictEqual(model.totalMs, 15 * MIN);
    node_assert_1.default.strictEqual(sum(model.bars), 15 * MIN);
    node_assert_1.default.strictEqual(model.bars[10].ms, 15 * MIN);
    node_assert_1.default.deepStrictEqual(model.projects.map((p) => [p.name, p.ms, p.percent]), [['proj', 10 * MIN, 67], ['other', 5 * MIN, 33]]);
});
(0, node_test_1.test)('more than eight projects: top seven stay, the rest fold into "Other"; percents add up', () => {
    const data = Array.from({ length: 9 }, (_, n) => iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
    const { projects } = build(data, 'today');
    node_assert_1.default.strictEqual(projects.length, 8);
    node_assert_1.default.strictEqual(projects[7].name, 'Other');
    node_assert_1.default.strictEqual(projects[7].ms, 20 * MIN);
    node_assert_1.default.deepStrictEqual(projects.map((p) => p.percent), [11, 11, 11, 11, 11, 11, 11, 22]);
});
(0, node_test_1.test)('exactly eight projects are all shown without "Other"', () => {
    const data = Array.from({ length: 8 }, (_, n) => iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
    const { projects } = build(data, 'today');
    node_assert_1.default.strictEqual(projects.length, 8);
    node_assert_1.default.ok(projects.every((p) => p.name !== 'Other'));
});
(0, node_test_1.test)('the empty language is labelled "Terminal / other"', () => {
    const { languages } = build([iv(at(8, 9), at(8, 9, 30), { language: '', file: undefined })], 'today');
    node_assert_1.default.deepStrictEqual(languages.map((l) => l.name), [dashboardModel_1.TERMINAL_LABEL]);
});
(0, node_test_1.test)('an empty range has zeroed bars and no lists', () => {
    const week = build([], 'week');
    node_assert_1.default.strictEqual(week.totalMs, 0);
    node_assert_1.default.strictEqual(week.bars.length, 7);
    node_assert_1.default.ok(week.bars.every((b) => b.ms === 0));
    node_assert_1.default.deepStrictEqual([week.projects, week.languages, week.sessions], [[], [], []]);
    node_assert_1.default.deepStrictEqual(build([], 'all').bars, []);
});
(0, node_test_1.test)('week and month use one bar per local day, zero-filled', () => {
    const data = [iv(at(7, 10), at(7, 10, 30))]; // Wed 7 Oct
    const week = build(data, 'week');
    node_assert_1.default.strictEqual(week.barUnit, 'day');
    node_assert_1.default.strictEqual(week.bars.length, 7);
    node_assert_1.default.strictEqual(week.bars[0].startMs, at(5, 0));
    node_assert_1.default.strictEqual(week.bars[0].label, 'Mon 5 Oct');
    node_assert_1.default.strictEqual(week.bars[2].ms, 30 * MIN);
    node_assert_1.default.strictEqual(sum(week.bars), week.totalMs);
    const month = build(data, 'month');
    node_assert_1.default.strictEqual(month.bars.length, 31);
    node_assert_1.default.strictEqual(month.bars[6].ms, 30 * MIN);
});
(0, node_test_1.test)('all time: one bar per month from the first recorded month, gaps filled', () => {
    const data = [iv(at(20, 10, 0, 7), at(20, 11, 0, 7)), iv(at(8, 10), at(8, 11))]; // 20 Aug and 8 Oct
    const model = build(data, 'all');
    node_assert_1.default.strictEqual(model.barUnit, 'month');
    node_assert_1.default.deepStrictEqual(model.bars.map((b) => [b.label, b.ms]), [['Aug 2026', HOUR], ['Sep 2026', 0], ['Oct 2026', HOUR]]);
});
(0, node_test_1.test)('two years of history under "all time" keep one bar per month and the right total', () => {
    const data = Array.from({ length: 24 }, (_, k) => {
        const start = new Date(2024, 10 + k, 15, 10).getTime(); // Nov 2024 .. Oct 2026
        return iv(start, start + HOUR);
    });
    const model = build(data, 'all');
    node_assert_1.default.strictEqual(model.bars.length, 24);
    node_assert_1.default.ok(model.bars.every((b) => b.ms === HOUR));
    node_assert_1.default.strictEqual(model.totalMs, 24 * HOUR);
    node_assert_1.default.strictEqual(sum(model.bars), model.totalMs);
});
(0, node_test_1.test)('sessions are newest first and capped', () => {
    const data = Array.from({ length: 60 }, (_, n) => iv(at(1, 0) + n * HOUR, at(1, 0) + n * HOUR + MIN));
    const model = build(data, 'month');
    node_assert_1.default.strictEqual(model.sessions.length, dashboardModel_1.MAX_SESSIONS);
    node_assert_1.default.strictEqual(model.sessions[0].start, at(1, 0) + 59 * HOUR);
    node_assert_1.default.strictEqual(model.sessions[dashboardModel_1.MAX_SESSIONS - 1].start, at(1, 0) + 10 * HOUR);
    node_assert_1.default.ok(model.sessions.every((s, i, all) => i === 0 || s.start < all[i - 1].start));
    node_assert_1.default.deepStrictEqual(model.sessions[0], {
        start: at(1, 0) + 59 * HOUR, end: at(1, 0) + 59 * HOUR + MIN, ms: MIN, projects: ['proj'], languages: ['typescript'], files: ['a.ts'],
    });
});
(0, node_test_1.test)('the enabled flag is passed through and existing data is still shown', () => {
    const model = build([iv(at(8, 9), at(8, 9, 30))], 'today', NOW, false);
    node_assert_1.default.strictEqual(model.enabled, false);
    node_assert_1.default.strictEqual(model.totalMs, 30 * MIN);
});
(0, node_test_1.test)('isDashboardRange accepts only the five presets', () => {
    for (const r of ['today', 'yesterday', 'week', 'month', 'all'])
        node_assert_1.default.ok((0, dashboardModel_1.isDashboardRange)(r));
    for (const r of ['custom', '', 'TODAY', null, undefined, 3, {}])
        node_assert_1.default.ok(!(0, dashboardModel_1.isDashboardRange)(r));
});
(0, node_test_1.test)('parseWebviewMessage keeps valid intents, strips extra fields and ignores everything else', () => {
    for (const type of ['ready', 'enableTracking', 'showTrackedData', 'openSettings']) {
        node_assert_1.default.deepStrictEqual((0, dashboardModel_1.parseWebviewMessage)({ type, evil: 1 }), { type });
    }
    node_assert_1.default.deepStrictEqual((0, dashboardModel_1.parseWebviewMessage)({ type: 'setRange', range: 'week' }), { type: 'setRange', range: 'week' });
    for (const bad of [
        { type: 'setRange' }, { type: 'setRange', range: 'custom' }, { type: 'setRange', range: 7 }, { type: 'delete' }, { type: 3 },
        {}, null, undefined, 'ready', 42, [],
    ]) {
        node_assert_1.default.strictEqual((0, dashboardModel_1.parseWebviewMessage)(bad), undefined);
    }
});
//# sourceMappingURL=dashboardModel.test.js.map