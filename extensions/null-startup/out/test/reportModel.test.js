/// <reference path="../protocol.ts" />
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const reportModel_1 = require("../reportModel");
const report = (id, takenAt, headlineMs, over = {}) => ({
    schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1.0', initialStartup: true, partial: false, headlineMs,
    milestones: [{ id: 'workspaceRestored', label: 'Workspace restored', atMs: headlineMs }],
    phases: [
        { id: 'p1', label: 'Phase 1', process: 'renderer', startMs: 0, endMs: 300, durationMs: 300, impactMs: 300 },
        { id: 'p2', label: 'Phase 2', process: 'renderer', startMs: 100, endMs: 150, durationMs: 50, impactMs: 0 },
        { id: 'p3', label: 'Phase 3', process: 'main' },
    ],
    extensions: [
        { id: 'p.a', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 0, endMs: 400, totalMs: 400, impactMs: 400 },
        { id: 'p.b', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 100, endMs: 200, totalMs: 30, impactMs: 0 },
        { id: 'p.c', activationEvent: '*', reason: '', eager: false, deferred: true },
    ],
    ...over,
});
const history = [report('c', 3000, 1200), report('b', 2000, 1000), report('a', 1000, 900)];
(0, node_test_1.test)('no history gives an empty, usable model', () => {
    const m = (0, reportModel_1.buildViewModel)([], { baseline: 'previous', slowMs: 100 });
    node_assert_1.default.strictEqual(m.hasReport, false);
    node_assert_1.default.deepStrictEqual([m.phases, m.extensions, m.launches], [[], [], []]);
    node_assert_1.default.ok(m.spanMs >= 1);
});
(0, node_test_1.test)('selects the newest report by default, flags slow extensions, assigns lanes, ranks the slowest', () => {
    const m = (0, reportModel_1.buildViewModel)(history, { baseline: 'none', slowMs: 100 });
    node_assert_1.default.strictEqual(m.reportId, 'c');
    node_assert_1.default.strictEqual(m.headlineMs, 1200);
    node_assert_1.default.strictEqual(m.launches.length, 3);
    const e = Object.fromEntries(m.extensions.map((x) => [x.id, x]));
    node_assert_1.default.strictEqual(e['p.a'].slow, true);
    node_assert_1.default.strictEqual(e['p.b'].slow, false);
    node_assert_1.default.strictEqual(e['p.c'].slow, false, 'unknown total is never slow');
    node_assert_1.default.deepStrictEqual([e['p.a'].lane, e['p.b'].lane], [0, 1], 'overlapping activations get separate lanes');
    node_assert_1.default.deepStrictEqual(m.slowestPhases.map((p) => p.id), ['p1'], 'p2 is fully covered by p1, so it adds no wall-clock time');
    node_assert_1.default.deepStrictEqual(m.slowestExtensions.map((x) => x.id), ['p.a', 'p.b']);
    node_assert_1.default.strictEqual(m.spanMs, 1200);
    node_assert_1.default.strictEqual(m.comparison, undefined);
});
(0, node_test_1.test)('baseline previous compares with the next older launch; median with all others', () => {
    const prev = (0, reportModel_1.buildViewModel)(history, { baseline: 'previous', slowMs: 100 });
    node_assert_1.default.strictEqual(prev.comparison.headline.baseMs, 1000);
    node_assert_1.default.strictEqual(prev.comparison.headline.deltaMs, 200);
    const med = (0, reportModel_1.buildViewModel)(history, { baseline: 'median', slowMs: 100 });
    node_assert_1.default.strictEqual(med.comparison.headline.baseMs, 950);
    const oldest = (0, reportModel_1.buildViewModel)(history, { selectedId: 'a', baseline: 'previous', slowMs: 100 });
    node_assert_1.default.strictEqual(oldest.comparison, undefined, 'nothing older to compare with');
});
(0, node_test_1.test)('a selected id that no longer exists falls back to the newest', () => {
    node_assert_1.default.strictEqual((0, reportModel_1.buildViewModel)(history, { selectedId: 'gone', baseline: 'none', slowMs: 100 }).reportId, 'c');
});
(0, node_test_1.test)('parseWebviewMessage accepts only well-formed intents', () => {
    node_assert_1.default.deepStrictEqual((0, reportModel_1.parseWebviewMessage)({ type: 'ready' }), { type: 'ready' });
    node_assert_1.default.deepStrictEqual((0, reportModel_1.parseWebviewMessage)({ type: 'copy' }), { type: 'copy' });
    node_assert_1.default.deepStrictEqual((0, reportModel_1.parseWebviewMessage)({ type: 'select', reportId: 'a' }), { type: 'select', reportId: 'a' });
    node_assert_1.default.deepStrictEqual((0, reportModel_1.parseWebviewMessage)({ type: 'setBaseline', baseline: 'median' }), { type: 'setBaseline', baseline: 'median' });
    for (const bad of [null, 'x', {}, { type: 'select' }, { type: 'select', reportId: 5 }, { type: 'setBaseline', baseline: 'weird' }, { type: 'nope' }]) {
        node_assert_1.default.strictEqual((0, reportModel_1.parseWebviewMessage)(bad), undefined);
    }
});
//# sourceMappingURL=reportModel.test.js.map