'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const privacy_1 = require("../privacy");
const at = (day, h = 0, month = 9) => new Date(2026, month, day, h).getTime();
(0, node_test_1.test)('choiceRange', () => {
    const now = at(8, 15);
    node_assert_1.default.deepStrictEqual((0, privacy_1.choiceRange)('today', now), { from: at(8), to: at(9) });
    node_assert_1.default.deepStrictEqual((0, privacy_1.choiceRange)('last7', now), { from: at(2), to: at(9) });
    node_assert_1.default.deepStrictEqual((0, privacy_1.choiceRange)('month', now), { from: at(1), to: at(1, 0, 10) });
});
(0, node_test_1.test)('parseDay accepts only real YYYY-MM-DD dates', () => {
    node_assert_1.default.strictEqual((0, privacy_1.parseDay)('2026-10-08'), at(8));
    for (const bad of ['2026-02-31', '2026-13-01', 'abc', '2026-1-1', '', ' 2026-10-08']) {
        node_assert_1.default.strictEqual((0, privacy_1.parseDay)(bad), undefined, bad);
    }
});
(0, node_test_1.test)('customRange includes the end day and rejects reversed or invalid input', () => {
    node_assert_1.default.deepStrictEqual((0, privacy_1.customRange)('2026-10-05', '2026-10-07'), { from: at(5), to: at(8) });
    node_assert_1.default.deepStrictEqual((0, privacy_1.customRange)('2026-10-05', '2026-10-05'), { from: at(5), to: at(6) });
    node_assert_1.default.strictEqual((0, privacy_1.customRange)('2026-10-07', '2026-10-05'), undefined);
    node_assert_1.default.strictEqual((0, privacy_1.customRange)('nope', '2026-10-05'), undefined);
});
(0, node_test_1.test)('trackedDataReport lists fields, storage, state and monthly totals', () => {
    const text = (0, privacy_1.trackedDataReport)({
        storageDir: 'C:\\store',
        enabled: true,
        months: [{ day: '2026-09-01', ms: 125 * 60_000 }, { day: '2026-10-01', ms: 5 * 60_000 }],
    });
    for (const needle of ['C:\\store', 'on', 'git branch', 'Never recorded', 'no network', '2026-09  2h 5m', '2026-10  5m']) {
        node_assert_1.default.ok(text.includes(needle), needle);
    }
    node_assert_1.default.ok((0, privacy_1.trackedDataReport)({ storageDir: 'x', enabled: false, months: [] }).includes('(no data yet)'));
    node_assert_1.default.ok((0, privacy_1.trackedDataReport)({ storageDir: 'x', enabled: false, months: [] }).includes('Tracking: off'));
});
//# sourceMappingURL=privacy.test.js.map