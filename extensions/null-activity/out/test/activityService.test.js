'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const activityService_1 = require("../activityService");
const intervalStore_1 = require("../intervalStore");
const stats_1 = require("../stats");
const MIN = 60_000;
const at = (day, h, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).getTime();
const hb = (ts, over = {}) => ({
    ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over,
});
function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-svc-'));
    let now = at(8, 9);
    const settings = { enabled: true, idleTimeoutMs: 2 * MIN, sessionGapMs: 15 * MIN };
    const service = new activityService_1.ActivityService({
        store: new intervalStore_1.IntervalStore({ dir, windowId: 'w1' }),
        clock: () => now,
        settings: () => settings,
        resolveProject: (w) => ({ key: w ?? '(no folder)', name: 'proj' }),
    });
    return { service, settings, dir, at: (t) => { now = t; } };
}
const day = (0, stats_1.dayRange)(at(8, 12));
(0, node_test_1.test)('the open interval is visible through the API; closing fires onDidChange and refreshes reads', () => {
    const { service } = setup();
    let changes = 0;
    service.onDidChange(() => changes++);
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 1)));
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
    node_assert_1.default.strictEqual(changes, 0);
    service.recordActivity(hb(at(8, 9, 30), { file: 'b.ts' })); // gap > idle: closes at the last heartbeat
    node_assert_1.default.strictEqual(changes, 1);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
});
(0, node_test_1.test)('daily, project, language, session and monthly stats are derived from the log', () => {
    const { service, settings } = setup();
    settings.idleTimeoutMs = 20 * MIN; // heartbeats below are minutes apart
    service.refresh();
    service.recordActivity(hb(at(8, 9), { linesAdded: 3 }));
    service.recordActivity(hb(at(8, 9, 10)));
    service.recordActivity(hb(at(8, 9, 11), { language: 'rust', file: 'b.rs' }));
    service.recordActivity(hb(at(8, 9, 15), { language: 'rust', file: 'b.rs' }));
    service.endSession();
    node_assert_1.default.deepStrictEqual(service.getDailyStats(day), [{ day: '2026-10-08', ms: 15 * MIN }]);
    node_assert_1.default.deepStrictEqual(service.getLanguageStats(day).map((l) => l.language).sort(), ['rust', 'typescript']);
    const [project] = service.getProjectStats(day);
    node_assert_1.default.deepStrictEqual([project.ms, project.files, project.linesAdded], [15 * MIN, 2, 3]);
    node_assert_1.default.strictEqual(service.getSessions(day).length, 1);
    node_assert_1.default.deepStrictEqual(service.getMonthlyTotals(), [{ day: '2026-10-01', ms: 15 * MIN }]);
});
(0, node_test_1.test)('turning the master switch off closes the open interval and stops collection', () => {
    const { service, settings, at: setNow } = setup();
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 1)));
    setNow(at(8, 9, 2));
    settings.enabled = false;
    service.refresh();
    node_assert_1.default.strictEqual(service.enabled, false);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
    service.recordActivity(hb(at(8, 9, 3)));
    service.startSession(); // no-op while disabled
    service.recordActivity(hb(at(8, 9, 4)));
    service.recordActivity(hb(at(8, 9, 5)));
    node_assert_1.default.strictEqual(service.getIntervals(day).length, 1);
    settings.enabled = true;
    service.refresh();
    service.recordActivity(hb(at(8, 9, 10)));
    service.recordActivity(hb(at(8, 9, 11)));
    node_assert_1.default.strictEqual(service.getIntervals(day).length, 2);
});
(0, node_test_1.test)('pauseSession stops counting until startSession', () => {
    const { service, at: setNow } = setup();
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 0, 30)));
    setNow(at(8, 9, 1));
    service.pauseSession();
    service.recordActivity(hb(at(8, 9, 2)));
    service.recordActivity(hb(at(8, 9, 3)));
    node_assert_1.default.strictEqual(service.getIntervals(day).length, 1);
    service.startSession();
    service.recordActivity(hb(at(8, 9, 4)));
    service.recordActivity(hb(at(8, 9, 5)));
    node_assert_1.default.strictEqual(service.getIntervals(day).length, 2);
});
(0, node_test_1.test)('deleting a range while an interval is open does not bring the interval back', () => {
    const { service, at: setNow } = setup();
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 1)));
    setNow(at(8, 9, 1, 30));
    service.deleteRange(day);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day), []);
    service.recordActivity(hb(at(8, 9, 2)));
    service.recordActivity(hb(at(8, 9, 3)));
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9, 2), at(8, 9, 3)]]);
    service.deleteAll();
    node_assert_1.default.deepStrictEqual(service.getIntervals(day), []);
});
(0, node_test_1.test)('normalizeSettings clamps nonsense to sane values', () => {
    const d = { enabled: true, idleTimeoutMs: 900_000, sessionGapMs: 15 * MIN };
    node_assert_1.default.deepStrictEqual((0, activityService_1.normalizeSettings)({}), d);
    node_assert_1.default.deepStrictEqual((0, activityService_1.normalizeSettings)({ enabled: false }), { ...d, enabled: false });
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ idleTimeout: 0 }).idleTimeoutMs, 10_000);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ idleTimeout: -5 }).idleTimeoutMs, 10_000);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ idleTimeout: Number.NaN }).idleTimeoutMs, 900_000);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ idleTimeout: 'abc' }).idleTimeoutMs, 900_000);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ idleTimeout: 1e9 }).idleTimeoutMs, 3_600_000);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ sessionGap: 0 }).sessionGapMs, MIN);
    node_assert_1.default.strictEqual((0, activityService_1.normalizeSettings)({ sessionGap: 1e9 }).sessionGapMs, 1_440 * MIN);
});
(0, node_test_1.test)('replaceImported replaces the previous import, fires onDidChange, counts overlap with native time once, and is cleared by deleteAll', () => {
    const { service } = setup();
    let changes = 0;
    service.onDidChange(() => changes++);
    const imported = (start, end) => ({
        start, end, project: { key: 'old', name: 'old' }, language: 'cpp', linesAdded: 0, linesRemoved: 0,
    });
    node_assert_1.default.strictEqual(service.hasImport(), false);
    service.replaceImported([imported(at(8, 9), at(8, 10))]);
    service.replaceImported([imported(at(8, 11), at(8, 12))]);
    node_assert_1.default.strictEqual(changes, 2);
    node_assert_1.default.strictEqual(service.hasImport(), true);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 11), at(8, 12)]]);
    // Native tracking 11:59–12:01 overlaps the end of the imported hour: 61 minutes in total, not 62.
    service.recordActivity(hb(at(8, 11, 59)));
    service.recordActivity(hb(at(8, 12, 1)));
    const total = service.getIntervals(day).reduce((sum, i) => sum + i.end - i.start, 0);
    node_assert_1.default.strictEqual(total, 61 * MIN);
    service.deleteAll();
    node_assert_1.default.strictEqual(service.hasImport(), false);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day), []);
});
(0, node_test_1.test)('another window\'s time is summed per project but shares one headline total', () => {
    const { service, dir, settings } = setup();
    settings.idleTimeoutMs = 20 * MIN;
    service.refresh();
    const other = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    other.append({ start: at(8, 9), end: at(8, 9, 10), project: { key: '/x', name: 'x' }, language: 'rust', file: 'b.rs', linesAdded: 0, linesRemoved: 0 });
    other.flush();
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 10)));
    service.endSession();
    node_assert_1.default.deepStrictEqual(service.getProjectStats(day).map((p) => p.ms), [10 * MIN, 10 * MIN]);
    node_assert_1.default.deepStrictEqual(service.getLanguageStats(day).map((l) => l.language).sort(), ['rust', 'typescript']);
    node_assert_1.default.deepStrictEqual(service.getDailyStats(day), [{ day: '2026-10-08', ms: 10 * MIN }]);
    node_assert_1.default.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 10)]]);
});
(0, node_test_1.test)('the open interval of this window is summed with other windows too', () => {
    const { service, dir } = setup();
    const other = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    other.append({ start: at(8, 9), end: at(8, 9, 1), project: { key: '/x', name: 'x' }, language: 'rust', linesAdded: 0, linesRemoved: 0 });
    other.flush();
    service.recordActivity(hb(at(8, 9)));
    service.recordActivity(hb(at(8, 9, 1)));
    node_assert_1.default.deepStrictEqual(service.getProjectStats(day).map((p) => p.ms), [MIN, MIN]);
});
//# sourceMappingURL=activityService.test.js.map