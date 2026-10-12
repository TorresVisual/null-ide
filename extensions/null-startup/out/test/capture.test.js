'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const capture_1 = require("../capture");
const snap = (extra = 0) => ({
    schemaVersion: 1, takenAt: 5000, appVersion: '1', initialStartup: true, metrics: {}, contributions: [],
    marks: [{ source: 'main', name: 'code/didStartMain', startTime: 1000 }, { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2000 }],
    extensions: Array.from({ length: extra }, (_, i) => ({ id: `p.e${i}`, activationEvent: '*', reason: '', eager: true })),
});
function harness(results) {
    const saved = [];
    const scheduled = [];
    const logs = [];
    let calls = 0;
    const deps = {
        snapshot: async () => {
            const r = results[Math.min(calls++, results.length - 1)];
            if (r instanceof Error)
                throw r;
            return r;
        },
        save: async (r) => void saved.push(r),
        now: () => 777,
        windowId: 'win',
        schedule: (fn, ms) => {
            const entry = { fn, ms, disposed: false };
            scheduled.push(entry);
            return { dispose: () => void (entry.disposed = true) };
        },
        log: (m) => void logs.push(m),
        onSaved: () => { },
    };
    return { capture: new capture_1.Capture(deps), saved, scheduled, logs };
}
(0, node_test_1.test)('saves a report at once and rewrites the same id after the settle delay', async () => {
    const h = harness([snap(0), snap(2)]);
    await h.capture.run();
    node_assert_1.default.strictEqual(h.saved.length, 1);
    node_assert_1.default.strictEqual(h.saved[0].id, '777-win');
    node_assert_1.default.strictEqual(h.scheduled[0].ms, capture_1.SETTLE_DELAY_MS);
    h.scheduled[0].fn();
    await new Promise((r) => setImmediate(r));
    node_assert_1.default.strictEqual(h.saved.length, 2);
    node_assert_1.default.strictEqual(h.saved[1].id, '777-win');
    node_assert_1.default.strictEqual(h.saved[1].extensions.length, 2, 'the later snapshot supersedes the first');
});
(0, node_test_1.test)('no snapshot (stock VS Code): nothing saved, nothing scheduled', async () => {
    const h = harness([undefined]);
    await h.capture.run();
    node_assert_1.default.deepStrictEqual([h.saved.length, h.scheduled.length], [0, 0]);
});
(0, node_test_1.test)('a failing second snapshot keeps the first report', async () => {
    const h = harness([snap(1), new Error('boom')]);
    await h.capture.run();
    h.scheduled[0].fn();
    await new Promise((r) => setImmediate(r));
    node_assert_1.default.strictEqual(h.saved.length, 1);
    node_assert_1.default.ok(h.logs.some((l) => l.includes('boom')));
});
(0, node_test_1.test)('dispose cancels the pending second snapshot', async () => {
    const h = harness([snap(0)]);
    await h.capture.run();
    h.capture.dispose();
    node_assert_1.default.strictEqual(h.scheduled[0].disposed, true);
});
//# sourceMappingURL=capture.test.js.map