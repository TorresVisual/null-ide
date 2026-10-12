'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const snapshot_1 = require("../snapshot");
const valid = {
    schemaVersion: 1, takenAt: 5, appVersion: '1.0.0', initialStartup: true,
    metrics: { a: 1, b: 'x', c: Number.POSITIVE_INFINITY },
    marks: [{ source: 'main', name: 'code/didStartMain', startTime: 10 }, { name: 7 }, null],
    contributions: [{ phase: 2, id: 'x', ms: 3 }, { phase: 'z' }],
    extensions: [{ id: 'p.a', activationEvent: '*', reason: 'p.a', eager: true, startMs: 1, endMs: 2, loadMs: 'nope' }, { id: 5 }],
};
(0, node_test_1.test)('parseSnapshot keeps valid entries and drops malformed ones', () => {
    const s = (0, snapshot_1.parseSnapshot)(valid);
    node_assert_1.default.deepStrictEqual(s.metrics, { a: 1 });
    node_assert_1.default.deepStrictEqual(s.marks, [{ source: 'main', name: 'code/didStartMain', startTime: 10 }]);
    node_assert_1.default.deepStrictEqual(s.contributions, [{ phase: 2, id: 'x', ms: 3 }]);
    node_assert_1.default.strictEqual(s.extensions.length, 1);
    node_assert_1.default.strictEqual(s.extensions[0].id, 'p.a');
    node_assert_1.default.strictEqual(s.extensions[0].loadMs, undefined, 'non-numeric timing becomes undefined');
    node_assert_1.default.strictEqual(s.extensions[0].startMs, 1);
});
(0, node_test_1.test)('parseSnapshot rejects non-objects and unknown schema versions', () => {
    node_assert_1.default.strictEqual((0, snapshot_1.parseSnapshot)(undefined), undefined);
    node_assert_1.default.strictEqual((0, snapshot_1.parseSnapshot)('x'), undefined);
    node_assert_1.default.strictEqual((0, snapshot_1.parseSnapshot)({ ...valid, schemaVersion: 2 }), undefined);
});
(0, node_test_1.test)('parseSnapshot tolerates missing arrays', () => {
    const s = (0, snapshot_1.parseSnapshot)({ schemaVersion: 1, takenAt: 1, appVersion: '1', initialStartup: false });
    node_assert_1.default.deepStrictEqual([s.marks, s.contributions, s.extensions], [[], [], []]);
});
//# sourceMappingURL=snapshot.test.js.map