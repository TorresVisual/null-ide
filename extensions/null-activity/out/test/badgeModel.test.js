'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const badgeModel_1 = require("../badgeModel");
const MIN = 60_000;
const source = (days, languages) => ({
    getDailyStats: () => days.map((ms, n) => ({ day: `2026-10-0${n + 1}`, ms })),
    getLanguageStats: () => languages.map(([language, ms]) => ({ language, ms })),
});
const values = (s) => (0, badgeModel_1.buildBadges)(s).map((b) => b.value);
(0, node_test_1.test)('empty log: zeros and "none", never NaN', () => {
    node_assert_1.default.deepStrictEqual(values(source([], [])), ['0m', '0m', 'none']);
});
(0, node_test_1.test)('total is the sum of all days; the average is over days with time', () => {
    const badges = (0, badgeModel_1.buildBadges)(source([120 * MIN, 60 * MIN], [['typescript', 180 * MIN]]));
    node_assert_1.default.deepStrictEqual(badges.map((b) => b.value), ['3h 0m', '1h 30m', 'typescript']);
    node_assert_1.default.deepStrictEqual(badges.map((b) => b.label), ['coding time', 'daily average', 'top language']);
    node_assert_1.default.deepStrictEqual(badges.map((b) => b.file), [
        'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
    ]);
});
(0, node_test_1.test)('top language skips terminal/unknown time', () => {
    node_assert_1.default.strictEqual(values(source([60 * MIN], [['', 50 * MIN], ['rust', 10 * MIN]]))[2], 'rust');
    node_assert_1.default.strictEqual(values(source([60 * MIN], [['', 60 * MIN]]))[2], 'none');
});
//# sourceMappingURL=badgeModel.test.js.map