'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TIME = void 0;
exports.periodStart = periodStart;
exports.nextPeriodStart = nextPeriodStart;
exports.dayKey = dayKey;
exports.dayRange = dayRange;
exports.lastDaysRange = lastDaysRange;
exports.monthRange = monthRange;
exports.mergeClip = mergeClip;
exports.sliceInterval = sliceInterval;
exports.normalizeIntervals = normalizeIntervals;
exports.periodStats = periodStats;
exports.projectStats = projectStats;
exports.languageStats = languageStats;
exports.sessions = sessions;
exports.formatDuration = formatDuration;
exports.ALL_TIME = { from: 0, to: Number.MAX_SAFE_INTEGER };
function periodStart(ts, p) {
    const d = new Date(ts);
    if (p === 'month')
        return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const daysBack = p === 'week' ? (d.getDay() + 6) % 7 : 0; // Monday = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}
function nextPeriodStart(ts, p) {
    const s = new Date(periodStart(ts, p));
    if (p === 'month')
        return new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime();
    return new Date(s.getFullYear(), s.getMonth(), s.getDate() + (p === 'week' ? 7 : 1)).getTime();
}
function dayKey(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayRange(now) {
    return { from: periodStart(now, 'day'), to: nextPeriodStart(now, 'day') };
}
/** Today plus the previous `days - 1` days. */
function lastDaysRange(now, days) {
    const to = nextPeriodStart(now, 'day');
    const d = new Date(to);
    return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime(), to };
}
function monthRange(now) {
    return { from: periodStart(now, 'month'), to: nextPeriodStart(now, 'month') };
}
/**
 * Sorts intervals from every window and clips overlaps so concurrent windows (or a clock
 * jump) never double-count. Idempotent. Lines of a fully covered interval are dropped; this
 * only happens for the few ms two windows overlap at a focus hand-over.
 */
function mergeClip(intervals) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    let cursor = -Infinity;
    for (const i of sorted) {
        if (i.end <= cursor)
            continue;
        out.push(i.start < cursor ? { ...i, start: cursor } : i);
        cursor = i.end;
    }
    return out;
}
/** The part of `i` inside [from, to). Lines are kept only when the piece contains `i.start`. */
function sliceInterval(i, from, to) {
    const start = Math.max(i.start, from);
    const end = Math.min(i.end, to);
    if (end <= start)
        return undefined;
    const keepsLines = start === i.start;
    return { ...i, start, end, linesAdded: keepsLines ? i.linesAdded : 0, linesRemoved: keepsLines ? i.linesRemoved : 0 };
}
function normalizeIntervals(intervals, range) {
    return mergeClip(intervals).flatMap((i) => sliceInterval(i, range.from, range.to) ?? []);
}
function* pieces(i, p) {
    for (let from = i.start; from < i.end;) {
        const to = nextPeriodStart(from, p);
        const piece = sliceInterval(i, from, Math.min(to, i.end));
        if (piece)
            yield piece;
        from = to;
    }
}
/** Time per day, week or month. `day` is the local `YYYY-MM-DD` of the bucket start. */
function periodStats(intervals, range, period) {
    const totals = new Map();
    for (const i of normalizeIntervals(intervals, range)) {
        for (const piece of pieces(i, period)) {
            const key = periodStart(piece.start, period);
            totals.set(key, (totals.get(key) ?? 0) + piece.end - piece.start);
        }
    }
    return [...totals].sort((a, b) => a[0] - b[0]).map(([key, ms]) => ({ day: dayKey(key), ms }));
}
function projectStats(intervals, range) {
    const by = new Map();
    for (const i of normalizeIntervals(intervals, range)) {
        let s = by.get(i.project.key);
        if (!s)
            by.set(i.project.key, (s = { project: i.project, ms: 0, files: new Set(), linesAdded: 0, linesRemoved: 0 }));
        s.project = i.project; // intervals arrive in time order, so the latest name wins
        s.ms += i.end - i.start;
        s.linesAdded += i.linesAdded;
        s.linesRemoved += i.linesRemoved;
        if (i.file)
            s.files.add(i.file);
    }
    return [...by.values()]
        .map((s) => ({ project: s.project, ms: s.ms, files: s.files.size, linesAdded: s.linesAdded, linesRemoved: s.linesRemoved }))
        .sort((a, b) => b.ms - a.ms);
}
function languageStats(intervals, range) {
    const by = new Map();
    for (const i of normalizeIntervals(intervals, range))
        by.set(i.language, (by.get(i.language) ?? 0) + i.end - i.start);
    return [...by].map(([language, ms]) => ({ language, ms })).sort((a, b) => b.ms - a.ms);
}
/** Consecutive intervals with gaps <= gapMs form one session; duration is the sum of interval time. */
function sessions(intervals, range, gapMs) {
    const groups = [];
    for (const i of normalizeIntervals(intervals, range)) {
        let g = groups[groups.length - 1];
        if (!g || i.start - g.session.end > gapMs) {
            g = {
                session: { start: i.start, end: i.end, durationMs: 0, projects: [], languages: [], files: [] },
                projects: new Map(),
                languages: new Set(),
                files: new Set(),
            };
            groups.push(g);
        }
        g.session.end = i.end;
        g.session.durationMs += i.end - i.start;
        g.projects.set(i.project.key, i.project);
        if (i.language)
            g.languages.add(i.language);
        if (i.file)
            g.files.add(i.file);
    }
    return groups.map((g) => ({ ...g.session, projects: [...g.projects.values()], languages: [...g.languages], files: [...g.files] }));
}
function formatDuration(ms) {
    const minutes = Math.floor(ms / 60_000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
//# sourceMappingURL=stats.js.map