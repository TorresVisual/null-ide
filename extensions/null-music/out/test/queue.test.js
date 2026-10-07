'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const queue_1 = require("../playback/queue");
const fixtures_1 = require("./fixtures");
function seeded(seed) {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}
const tracks = (n) => Array.from({ length: n }, (_, i) => (0, fixtures_1.track)(i));
const names = (q) => q.tracks.map((t) => t.name);
(0, node_test_1.test)('next walks the list, stops at the end, wraps only for repeat=context', () => {
    const q = new queue_1.Queue();
    q.replace(tracks(3), 0);
    node_assert_1.default.strictEqual(q.next()?.name, 't1');
    node_assert_1.default.strictEqual(q.next()?.name, 't2');
    node_assert_1.default.strictEqual(q.next(), undefined);
    node_assert_1.default.strictEqual(q.current?.name, 't2');
    q.repeat = 'context';
    node_assert_1.default.strictEqual(q.next()?.name, 't0');
});
(0, node_test_1.test)('shuffle never repeats a track back to back and covers everything first', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const q = new queue_1.Queue(seeded(seed));
        q.replace(tracks(5), 0);
        q.setShuffle(true);
        q.repeat = 'context';
        const seq = [q.current.name];
        for (let i = 0; i < 24; i++)
            seq.push(q.next().name);
        for (let i = 1; i < seq.length; i++)
            node_assert_1.default.notStrictEqual(seq[i], seq[i - 1], `seed ${seed}`);
        node_assert_1.default.strictEqual(new Set(seq.slice(0, 5)).size, 5, `seed ${seed}`);
    }
});
(0, node_test_1.test)('shuffle with repeat off ends after every track played once', () => {
    const q = new queue_1.Queue(seeded(3));
    q.replace(tracks(4), 0);
    q.setShuffle(true);
    for (let i = 0; i < 3; i++)
        node_assert_1.default.ok(q.next());
    node_assert_1.default.strictEqual(q.next(), undefined);
});
(0, node_test_1.test)('single track + shuffle + repeat context replays the same track', () => {
    const q = new queue_1.Queue();
    q.replace(tracks(1), 0);
    q.setShuffle(true);
    q.repeat = 'context';
    node_assert_1.default.strictEqual(q.next()?.name, 't0');
});
(0, node_test_1.test)('previous walks history regardless of shuffle, and forward returns to where you were', () => {
    const q = new queue_1.Queue(seeded(7));
    q.replace(tracks(5), 0);
    q.setShuffle(true);
    const first = q.current.name;
    const second = q.next().name;
    const third = q.next().name;
    node_assert_1.default.strictEqual(q.previous()?.name, second);
    node_assert_1.default.strictEqual(q.next()?.name, third);
    node_assert_1.default.strictEqual(q.previous()?.name, second);
    node_assert_1.default.strictEqual(q.previous()?.name, first);
    node_assert_1.default.strictEqual(q.previous(), undefined);
});
(0, node_test_1.test)('previous without history steps back in list order (non-shuffle)', () => {
    const q = new queue_1.Queue();
    q.replace(tracks(3), 2);
    node_assert_1.default.strictEqual(q.previous()?.name, 't1');
    node_assert_1.default.strictEqual(q.previous()?.name, 't0');
    node_assert_1.default.strictEqual(q.previous(), undefined);
});
(0, node_test_1.test)('playNext inserts after current; add appends; both play in shuffle too', () => {
    const q = new queue_1.Queue();
    q.replace(tracks(3), 0);
    q.playNext((0, fixtures_1.track)(9));
    q.add((0, fixtures_1.track)(8));
    node_assert_1.default.deepStrictEqual(names(q), ['t0', 't9', 't1', 't2', 't8']);
    node_assert_1.default.strictEqual(q.next()?.name, 't9');
    const s = new queue_1.Queue(seeded(2));
    s.replace(tracks(4), 0);
    s.setShuffle(true);
    s.playNext((0, fixtures_1.track)(9));
    node_assert_1.default.strictEqual(s.next()?.name, 't9');
    s.add((0, fixtures_1.track)(8));
    const seen = new Set();
    for (let i = 0; i < 4; i++)
        seen.add(s.next().name);
    node_assert_1.default.ok(seen.has('t8'));
});
(0, node_test_1.test)('add and playNext on an empty queue make the new track current', () => {
    const q = new queue_1.Queue();
    q.add((0, fixtures_1.track)(1));
    node_assert_1.default.strictEqual(q.current?.name, 't1');
    const p = new queue_1.Queue();
    p.playNext((0, fixtures_1.track)(2));
    node_assert_1.default.strictEqual(p.current?.name, 't2');
});
(0, node_test_1.test)('remove and move keep the current item current', () => {
    const q = new queue_1.Queue();
    q.replace(tracks(4), 2);
    q.remove(0);
    node_assert_1.default.strictEqual(q.current?.name, 't2');
    node_assert_1.default.strictEqual(q.index, 1);
    q.move(0, 2);
    node_assert_1.default.deepStrictEqual(names(q), ['t2', 't3', 't1']);
    node_assert_1.default.strictEqual(q.current?.name, 't2');
    node_assert_1.default.strictEqual(q.index, 0);
    q.remove(q.index);
    node_assert_1.default.strictEqual(q.current?.name, 't3');
    q.clear();
    node_assert_1.default.strictEqual(q.current, undefined);
    node_assert_1.default.strictEqual(q.index, -1);
});
//# sourceMappingURL=queue.test.js.map