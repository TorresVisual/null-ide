'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const tracker_1 = require("../tracker");
const IDLE = 120_000;
function setup() {
    let now = 0;
    let resolved = 0;
    const out = [];
    const tracker = new tracker_1.Tracker({
        clock: () => now,
        idleTimeoutMs: () => IDLE,
        resolveProject: (w) => {
            resolved++;
            return { key: w ?? '(no folder)', name: 'proj', branch: 'main' };
        },
        onInterval: (i) => out.push(i),
    });
    return { tracker, out, at: (ms) => { now = ms; }, resolveCount: () => resolved };
}
function hb(ts, over = {}) {
    return { ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over };
}
(0, node_test_1.test)('heartbeats within the idle timeout merge into one interval closed by tick()', () => {
    const { tracker, out, at, resolveCount } = setup();
    tracker.heartbeat(hb(1_000, { linesAdded: 2 }));
    tracker.heartbeat(hb(61_000, { linesAdded: 3, linesRemoved: 1 }));
    tracker.heartbeat(hb(100_000));
    node_assert_1.default.strictEqual(out.length, 0);
    at(100_000 + IDLE + 1);
    tracker.tick();
    node_assert_1.default.deepStrictEqual(out, [
        { start: 1_000, end: 100_000, project: { key: '/w', name: 'proj' }, language: 'typescript', file: 'a.ts', branch: 'main', linesAdded: 5, linesRemoved: 1 },
    ]);
    node_assert_1.default.strictEqual(resolveCount(), 1, 'project resolved once per interval, not per heartbeat');
});
(0, node_test_1.test)('a gap longer than the idle timeout closes at the last heartbeat and opens a new interval', () => {
    const { tracker, out } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(10_000));
    tracker.heartbeat(hb(10_000 + IDLE + 1));
    node_assert_1.default.strictEqual(out.length, 1);
    node_assert_1.default.strictEqual(out[0].start, 0);
    node_assert_1.default.strictEqual(out[0].end, 10_000);
    tracker.heartbeat(hb(10_000 + IDLE + 1_001));
    node_assert_1.default.strictEqual(tracker.peek()?.start, 10_000 + IDLE + 1);
    node_assert_1.default.strictEqual(tracker.peek()?.end, 10_000 + IDLE + 1_001);
});
(0, node_test_1.test)('a lone heartbeat that goes stale produces no interval', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(0));
    at(IDLE + 1);
    tracker.tick();
    node_assert_1.default.strictEqual(out.length, 0);
    node_assert_1.default.strictEqual(tracker.peek(), undefined);
});
(0, node_test_1.test)('tick() only closes when the gap is strictly greater than the idle timeout', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(10_000));
    at(10_000 + IDLE);
    tracker.tick();
    node_assert_1.default.strictEqual(out.length, 0);
    at(10_000 + IDLE + 1);
    tracker.tick();
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
});
(0, node_test_1.test)('switching file, language or project closes at the switch and re-resolves the project', () => {
    const changes = [{ file: 'b.ts' }, { language: 'json' }, { workspace: '/other' }];
    for (const change of changes) {
        const { tracker, out, at, resolveCount } = setup();
        tracker.heartbeat(hb(0));
        tracker.heartbeat(hb(30_000, { ...change, linesAdded: 4 }));
        node_assert_1.default.strictEqual(out.length, 1, JSON.stringify(change));
        node_assert_1.default.deepStrictEqual([out[0].start, out[0].end], [0, 30_000]);
        node_assert_1.default.strictEqual(resolveCount(), 2);
        at(40_000);
        tracker.closeOpen();
        node_assert_1.default.deepStrictEqual([out[1].start, out[1].end, out[1].linesAdded], [30_000, 40_000, 4]);
    }
});
(0, node_test_1.test)('focus loss closes the interval; heartbeats while unfocused are ignored', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(10_000));
    at(40_000);
    tracker.setFocused(false);
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 40_000]]);
    tracker.heartbeat(hb(50_000));
    tracker.setFocused(true);
    tracker.heartbeat(hb(60_000));
    tracker.heartbeat(hb(70_000));
    at(70_000);
    tracker.closeOpen();
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 40_000], [60_000, 70_000]]);
});
(0, node_test_1.test)('focus loss after a long silence ends at the last heartbeat, not at the loss', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(10_000));
    at(10_000 + IDLE + 5_000);
    tracker.setFocused(false);
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
});
(0, node_test_1.test)('a clock that jumps backwards never yields negative or inflated time', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(100_000));
    tracker.heartbeat(hb(150_000));
    tracker.heartbeat(hb(50_000));
    tracker.heartbeat(hb(60_000));
    at(60_000);
    tracker.closeOpen();
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[100_000, 150_000], [50_000, 60_000]]);
    node_assert_1.default.ok(out.every((i) => i.end > i.start));
});
(0, node_test_1.test)('sleep/wake: a heartbeat hours later does not credit the gap', () => {
    const { tracker, out } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(5_000));
    tracker.heartbeat(hb(8 * 3_600_000));
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 5_000]]);
});
(0, node_test_1.test)('setActive(false) closes the open interval and ignores heartbeats until re-enabled', () => {
    const { tracker, out, at } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(10_000));
    at(20_000);
    tracker.setActive(false);
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 20_000]]);
    tracker.heartbeat(hb(30_000));
    tracker.setActive(true);
    tracker.heartbeat(hb(40_000));
    tracker.heartbeat(hb(50_000));
    at(50_000);
    tracker.closeOpen();
    node_assert_1.default.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 20_000], [40_000, 50_000]]);
});
(0, node_test_1.test)('peek() reports the open interval up to the last heartbeat without closing it', () => {
    const { tracker, out } = setup();
    node_assert_1.default.strictEqual(tracker.peek(), undefined);
    tracker.heartbeat(hb(0));
    node_assert_1.default.strictEqual(tracker.peek(), undefined, 'a single heartbeat has no duration yet');
    tracker.heartbeat(hb(5_000));
    node_assert_1.default.deepStrictEqual([tracker.peek()?.start, tracker.peek()?.end], [0, 5_000]);
    node_assert_1.default.strictEqual(out.length, 0);
});
(0, node_test_1.test)('lineDelta counts inserted newlines and removed lines', () => {
    const range = (a, b) => ({ start: { line: a }, end: { line: b } });
    node_assert_1.default.deepStrictEqual((0, tracker_1.lineDelta)([{ text: 'a\nb\n', range: range(3, 3) }]), { linesAdded: 2, linesRemoved: 0 });
    node_assert_1.default.deepStrictEqual((0, tracker_1.lineDelta)([{ text: '', range: range(3, 5) }]), { linesAdded: 0, linesRemoved: 2 });
    node_assert_1.default.deepStrictEqual((0, tracker_1.lineDelta)([{ text: 'x\r\ny', range: range(4, 4) }]), { linesAdded: 1, linesRemoved: 0 });
    node_assert_1.default.deepStrictEqual((0, tracker_1.lineDelta)([{ text: 'a\n', range: range(0, 0) }, { text: '', range: range(9, 10) }]), { linesAdded: 1, linesRemoved: 1 });
});
//# sourceMappingURL=tracker.test.js.map