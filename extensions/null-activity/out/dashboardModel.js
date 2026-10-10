/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_LABEL = exports.MAX_SESSIONS = exports.MAX_SHARES = void 0;
exports.isDashboardRange = isDashboardRange;
exports.parseWebviewMessage = parseWebviewMessage;
exports.rangeFor = rangeFor;
exports.hourlyStats = hourlyStats;
exports.toShares = toShares;
exports.buildDashboardModel = buildDashboardModel;
const stats_1 = require("./stats");
exports.MAX_SHARES = 8;
exports.MAX_SESSIONS = 50;
exports.TERMINAL_LABEL = 'Terminal / other';
const RANGES = ['today', 'yesterday', 'week', 'month', 'all'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const pad = (n) => String(n).padStart(2, '0');
function isDashboardRange(v) {
    return RANGES.includes(v);
}
/** Validates an untrusted webview message; unknown shapes and extra fields are dropped. */
function parseWebviewMessage(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const m = raw;
    switch (m.type) {
        case 'ready':
        case 'enableTracking':
        case 'showTrackedData':
        case 'openSettings':
            return { type: m.type };
        case 'setRange':
            return isDashboardRange(m.range) ? { type: 'setRange', range: m.range } : undefined;
        default:
            return undefined;
    }
}
function rangeFor(range, now) {
    switch (range) {
        case 'today':
            return (0, stats_1.dayRange)(now);
        case 'yesterday': {
            const to = (0, stats_1.periodStart)(now, 'day');
            const d = new Date(to);
            return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime(), to };
        }
        case 'week':
            return { from: (0, stats_1.periodStart)(now, 'week'), to: (0, stats_1.nextPeriodStart)(now, 'week') };
        case 'month':
            return (0, stats_1.monthRange)(now);
        case 'all':
            return stats_1.ALL_TIME;
    }
}
function rangeLabel(range, r) {
    switch (range) {
        case 'today':
            return 'Today';
        case 'yesterday':
            return 'Yesterday';
        case 'all':
            return 'All time';
        case 'month': {
            const d = new Date(r.from);
            return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        }
        case 'week': {
            const first = new Date(r.from);
            const last = new Date(r.to - 1);
            const startMonth = first.getMonth() === last.getMonth() ? '' : ` ${MONTHS[first.getMonth()]}`;
            return `${DAYS[first.getDay()]} ${first.getDate()}${startMonth} – ${DAYS[last.getDay()]} ${last.getDate()} ${MONTHS[last.getMonth()]}`;
        }
    }
}
/**
 * Time per local clock hour (index 0-23) within a one-day range. Bucketed by wall-clock hour, so a
 * DST day still sums to its real length: the repeated hour lands in one bucket, the skipped hour stays 0.
 */
function hourlyStats(intervals, range) {
    const out = new Array(24).fill(0);
    for (const i of (0, stats_1.normalizeIntervals)(intervals, range)) {
        for (let from = i.start; from < i.end;) {
            const d = new Date(from);
            const intoHour = d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
            const to = Math.min(i.end, from - intoHour + 3_600_000);
            out[d.getHours()] += to - from;
            from = to;
        }
    }
    return out;
}
function hourlyBars(intervals, r) {
    const day = new Date(r.from);
    return hourlyStats(intervals, r).map((ms, h) => ({
        label: `${pad(h)}:00`,
        // ponytail: the hour skipped by a spring-forward day resolves to the next hour's start; startMs is only an identity.
        startMs: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime(),
        ms,
    }));
}
function dailyBars(api, r) {
    const byDay = new Map(api.getDailyStats(r).map((d) => [d.day, d.ms]));
    const bars = [];
    for (let t = r.from; t < r.to; t = (0, stats_1.nextPeriodStart)(t, 'day')) {
        const d = new Date(t);
        bars.push({ label: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`, startMs: t, ms: byDay.get((0, stats_1.dayKey)(t)) ?? 0 });
    }
    return bars;
}
function monthlyBars(intervals, now) {
    if (intervals.length === 0)
        return [];
    const byMonth = new Map((0, stats_1.periodStats)(intervals, stats_1.ALL_TIME, 'month').map((m) => [m.day, m.ms]));
    const end = (0, stats_1.nextPeriodStart)(now, 'month');
    const bars = [];
    // getIntervals returns time-ordered intervals, so [0] is the earliest.
    for (let t = (0, stats_1.periodStart)(intervals[0].start, 'month'); t < end; t = (0, stats_1.nextPeriodStart)(t, 'month')) {
        const d = new Date(t);
        bars.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, startMs: t, ms: byMonth.get((0, stats_1.dayKey)(t)) ?? 0 });
    }
    return bars;
}
/** Ranks by time, keeps at most MAX_SHARES rows (the last one "Other" when folding) and rounds percents. */
function toShares(items, totalMs) {
    const ranked = items.filter((i) => i.ms > 0).sort((a, b) => b.ms - a.ms);
    const shown = ranked.length > exports.MAX_SHARES ? ranked.slice(0, exports.MAX_SHARES - 1) : ranked;
    const rest = ranked.slice(shown.length).reduce((n, i) => n + i.ms, 0);
    if (rest > 0)
        shown.push({ name: 'Other', ms: rest });
    return shown.map((i) => ({ name: i.name, ms: i.ms, percent: totalMs > 0 ? Math.round((i.ms / totalMs) * 100) : 0 }));
}
function buildDashboardModel(api, range, now, enabled) {
    const r = rangeFor(range, now);
    const projects = api.getProjectStats(r);
    const totalMs = projects.reduce((n, p) => n + p.ms, 0);
    let bars;
    let barUnit;
    if (range === 'today' || range === 'yesterday') {
        bars = hourlyBars(api.getIntervals(r), r);
        barUnit = 'hour';
    }
    else if (range === 'all') {
        bars = monthlyBars(api.getIntervals(r), now);
        barUnit = 'month';
    }
    else {
        bars = dailyBars(api, r);
        barUnit = 'day';
    }
    return {
        range,
        rangeLabel: rangeLabel(range, r),
        enabled,
        totalMs,
        bars,
        barUnit,
        projects: toShares(projects.map((p) => ({ name: p.project.name, ms: p.ms })), totalMs),
        languages: toShares(api.getLanguageStats(r).map((l) => ({ name: l.language || exports.TERMINAL_LABEL, ms: l.ms })), totalMs),
        sessions: api
            .getSessions(r)
            .slice(-exports.MAX_SESSIONS)
            .reverse()
            .map((s) => ({
            start: s.start,
            end: s.end,
            ms: s.durationMs,
            projects: s.projects.map((p) => p.name),
            languages: s.languages,
            files: s.files,
        })),
    };
}
//# sourceMappingURL=dashboardModel.js.map