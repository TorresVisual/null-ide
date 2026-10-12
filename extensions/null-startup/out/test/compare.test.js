/// <reference path="../protocol.ts" />
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const compare_1 = require("../compare");
const format_1 = require("../format");
const report = (id, headline, phases, exts) => ({
    schemaVersion: 1, id, windowId: 'w', takenAt: 1, appVersion: '1', initialStartup: true, partial: false, headlineMs: headline,
    milestones: [],
    phases: Object.entries(phases).map(([id, durationMs]) => ({ id, label: id.toUpperCase(), process: 'renderer', durationMs })),
    extensions: Object.entries(exts).map(([id, totalMs]) => ({ id, activationEvent: '*', reason: id, eager: true, deferred: false, totalMs })),
});
(0, node_test_1.test)('a slowdown above both thresholds is a regression; small or relative-tiny ones are not', () => {
    const base = (0, compare_1.baselineOf)(report('a', 1000, { storage: 100, big: 2000 }, { 'p.x': 40 }));
    const cur = report('b', 1300, { storage: 110, big: 2100 }, { 'p.x': 160 });
    const c = (0, compare_1.compare)(cur, base, 'previous');
    node_assert_1.default.strictEqual(c.headline.deltaMs, 300);
    node_assert_1.default.strictEqual(c.headline.regression, true);
    const phase = Object.fromEntries(c.phases.map((p) => [p.id, p]));
    node_assert_1.default.strictEqual(phase['storage'].regression, false, '+10 ms is under 50 ms');
    node_assert_1.default.strictEqual(phase['big'].regression, false, '+100 ms but only 5 %');
    node_assert_1.default.strictEqual(c.extensions[0].id, 'p.x');
    node_assert_1.default.strictEqual(c.extensions[0].regression, true);
    node_assert_1.default.strictEqual(c.baseLabel, 'previous');
});
(0, node_test_1.test)('rows are sorted by slowdown and keep entries present on only one side', () => {
    const base = (0, compare_1.baselineOf)(report('a', 1000, { gone: 50 }, {}));
    const cur = report('b', undefined, { fresh: 70 }, {});
    const c = (0, compare_1.compare)(cur, base, 'x');
    const gone = c.phases.find((p) => p.id === 'gone');
    const fresh = c.phases.find((p) => p.id === 'fresh');
    node_assert_1.default.strictEqual(gone.deltaMs, undefined);
    node_assert_1.default.strictEqual(fresh.deltaMs, undefined);
    node_assert_1.default.strictEqual(fresh.label, 'FRESH');
    node_assert_1.default.strictEqual(c.headline.deltaMs, undefined);
    node_assert_1.default.strictEqual(c.headline.regression, false);
});
(0, node_test_1.test)('medianBaseline takes the median per key over the launches that have it', () => {
    const m = (0, compare_1.medianBaseline)([
        report('a', 100, { p: 10 }, { e: 1 }), report('b', 300, { p: 30 }, {}), report('c', 200, {}, { e: 5 }), report('d', 400, { p: 20 }, {}),
    ]);
    node_assert_1.default.strictEqual(m.headlineMs, 250);
    node_assert_1.default.strictEqual(m.phases['p'], 20);
    node_assert_1.default.strictEqual(m.extensions['e'], 3);
    node_assert_1.default.deepStrictEqual((0, compare_1.medianBaseline)([]), { headlineMs: undefined, phases: {}, extensions: {} });
});
(0, node_test_1.test)('format helpers', () => {
    node_assert_1.default.strictEqual((0, format_1.fmtMs)(undefined), 'n/a');
    node_assert_1.default.strictEqual((0, format_1.fmtMs)(12.4), '12 ms');
    node_assert_1.default.strictEqual((0, format_1.fmtMs)(1500), '1.50 s');
    node_assert_1.default.match((0, format_1.stamp)(Date.now()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
//# sourceMappingURL=compare.test.js.map