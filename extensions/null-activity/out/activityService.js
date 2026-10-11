'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityService = void 0;
exports.normalizeSettings = normalizeSettings;
const emitter_1 = require("./emitter");
const stats_1 = require("./stats");
const tracker_1 = require("./tracker");
const wakatimeImport_1 = require("./wakatimeImport");
const CACHE_TTL_MS = 15_000;
function normalizeSettings(raw) {
    const num = (v, fallback, min, max) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    return {
        enabled: raw.enabled !== false,
        idleTimeoutMs: num(raw.idleTimeout, 900, 10, 3_600) * 1_000,
        sessionGapMs: num(raw.sessionGap, 15, 1, 1_440) * 60_000,
    };
}
class ActivityService {
    opts;
    changed = new emitter_1.Emitter();
    onDidChange = this.changed.event;
    tracker;
    clock;
    cfg;
    paused = false;
    cache = new Map();
    constructor(opts) {
        this.opts = opts;
        this.clock = opts.clock ?? Date.now;
        this.cfg = { ...opts.settings() };
        this.tracker = new tracker_1.Tracker({
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
    get enabled() {
        return this.cfg.enabled;
    }
    /** Re-reads settings; call on configuration change. Disabling closes the open interval immediately. */
    refresh() {
        this.cfg = { ...this.opts.settings() };
        this.tracker.setActive(this.cfg.enabled && !this.paused);
    }
    startSession() {
        this.paused = false;
        this.refresh();
    }
    pauseSession() {
        this.paused = true;
        this.refresh();
    }
    endSession() {
        this.tracker.closeOpen();
        this.opts.store.flush();
    }
    recordActivity(h) {
        this.tracker.heartbeat(h);
    }
    tick() {
        this.tracker.tick();
    }
    flush() {
        this.opts.store.flush();
    }
    /** Un-merged intervals of every window, tagged with their window, plus this window's open interval. */
    raw(range) {
        const key = `${range.from}:${range.to}`;
        let hit = this.cache.get(key);
        if (!hit || this.clock() - hit.at >= CACHE_TTL_MS) {
            hit = { at: this.clock(), intervals: this.opts.store.read(range) };
            this.cache.set(key, hit);
        }
        const open = this.tracker.peek();
        return open ? [...hit.intervals, { ...open, window: this.opts.store.windowId }] : hit.intervals;
    }
    /** Union of every window, clipped to the range, including the in-progress interval. */
    getIntervals(range) {
        return (0, stats_1.normalizeIntervals)(this.raw(range), range);
    }
    getProjectStats(range) {
        return (0, stats_1.projectStats)(this.raw(range), range);
    }
    getLanguageStats(range) {
        return (0, stats_1.languageStats)(this.raw(range), range);
    }
    getDailyStats(range) {
        return (0, stats_1.periodStats)(this.raw(range), range, 'day');
    }
    getSessions(range) {
        return (0, stats_1.sessions)(this.raw(range), range, this.cfg.sessionGapMs);
    }
    getMonthlyTotals() {
        return (0, stats_1.periodStats)(this.raw(stats_1.ALL_TIME), stats_1.ALL_TIME, 'month');
    }
    /** Closes the open interval first so it is deleted with the rest instead of reappearing. */
    deleteRange(range) {
        this.tracker.closeOpen();
        this.opts.store.deleteRange(range);
        this.dataChanged();
    }
    deleteAll() {
        this.tracker.closeOpen();
        this.opts.store.deleteAll();
        this.dataChanged();
    }
    /** Swaps the previous WakaTime import for `intervals`. Internal: deliberately not on `NullActivityApi`. */
    replaceImported(intervals) {
        this.opts.store.replaceWindow(wakatimeImport_1.WAKATIME_WINDOW_ID, intervals);
        this.dataChanged();
    }
    hasImport() {
        return this.opts.store.hasWindow(wakatimeImport_1.WAKATIME_WINDOW_ID);
    }
    dispose() {
        this.endSession();
        this.changed.dispose();
    }
    dataChanged() {
        this.cache.clear();
        this.changed.fire();
    }
}
exports.ActivityService = ActivityService;
//# sourceMappingURL=activityService.js.map