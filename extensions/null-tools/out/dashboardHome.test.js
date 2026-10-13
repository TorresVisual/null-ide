'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const dashboardHome_1 = require("./dashboardHome");
(0, node_test_1.test)('homeUpdate is absent without an available update and ready only when the staged zip is verified', () => {
    strict_1.default.equal((0, dashboardHome_1.homeUpdate)(undefined, undefined), undefined);
    strict_1.default.deepEqual((0, dashboardHome_1.homeUpdate)({ latest: '1.4.0' }, undefined), { version: '1.4.0', ready: false });
    strict_1.default.deepEqual((0, dashboardHome_1.homeUpdate)({ latest: '1.4.0' }, { version: '1.4.0', verified: false }), { version: '1.4.0', ready: false });
    strict_1.default.deepEqual((0, dashboardHome_1.homeUpdate)({ latest: '1.4.0' }, { version: '1.3.9', verified: true }), { version: '1.4.0', ready: false });
    strict_1.default.deepEqual((0, dashboardHome_1.homeUpdate)({ latest: '1.4.0' }, { version: '1.4.0', verified: true }), { version: '1.4.0', ready: true });
});
(0, node_test_1.test)('todayMs sums the buckets from local midnight and is undefined without null-activity', () => {
    const now = new Date(2026, 9, 10, 15, 30).getTime();
    let range = { from: 0, to: 0 };
    const total = (0, dashboardHome_1.todayMs)({ getDailyStats: r => { range = r; return [{ ms: 60_000 }, { ms: 120_000 }]; } }, now);
    strict_1.default.equal(total, 180_000);
    strict_1.default.equal(range.from, new Date(2026, 9, 10).getTime());
    strict_1.default.ok(range.to > now);
    strict_1.default.equal((0, dashboardHome_1.todayMs)(undefined, now), undefined);
});
(0, node_test_1.test)('envMissing counts required findings and hides the row when there are none or no answer', () => {
    strict_1.default.equal((0, dashboardHome_1.envMissing)(undefined), undefined);
    strict_1.default.equal((0, dashboardHome_1.envMissing)([]), undefined);
    strict_1.default.equal((0, dashboardHome_1.envMissing)([{ severity: 'recommended' }]), undefined);
    strict_1.default.equal((0, dashboardHome_1.envMissing)([{ severity: 'required' }, { severity: 'recommended' }, { severity: 'required' }]), 2);
});
//# sourceMappingURL=dashboardHome.test.js.map