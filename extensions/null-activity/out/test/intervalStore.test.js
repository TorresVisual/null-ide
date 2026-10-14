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
const intervalStore_1 = require("../intervalStore");
const stats_1 = require("../stats");
const at = (day, h, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const iv = (start, end, over = {}) => ({
    start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-store-'));
const byStart = (a, b) => a.start - b.start;
(0, node_test_1.test)('append + flush + read round-trips and merges the files of two windows', () => {
    const dir = tmpDir();
    const a = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    const b = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    a.append(iv(at(8, 10), at(8, 11)));
    b.append(iv(at(8, 12), at(8, 13)));
    a.flush();
    b.flush();
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-10-w2.jsonl']);
    const got = a.read((0, stats_1.dayRange)(at(8, 12))).sort(byStart);
    node_assert_1.default.deepStrictEqual(got.map((i) => i.start), [at(8, 10), at(8, 12)]);
    node_assert_1.default.deepStrictEqual(a.read((0, stats_1.dayRange)(at(9, 12))), [], 'other days are filtered out');
});
(0, node_test_1.test)('unflushed intervals are readable', () => {
    const store = new intervalStore_1.IntervalStore({ dir: tmpDir(), windowId: 'w1' });
    store.append(iv(at(8, 10), at(8, 11)));
    node_assert_1.default.strictEqual(store.read((0, stats_1.dayRange)(at(8, 12))).length, 1);
});
(0, node_test_1.test)('a torn last line is skipped and a later append to the same file is still readable', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'intervals-2026-10-old.jsonl'), JSON.stringify(iv(at(8, 9), at(8, 10))) + '\n{"start":5,"en');
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'old' });
    node_assert_1.default.strictEqual(store.read((0, stats_1.dayRange)(at(8, 12))).length, 1);
    store.append(iv(at(8, 11), at(8, 12)));
    store.flush();
    node_assert_1.default.strictEqual(new intervalStore_1.IntervalStore({ dir, windowId: 'other' }).read((0, stats_1.dayRange)(at(8, 12))).length, 2);
});
(0, node_test_1.test)('a corrupt file never blocks the others', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'intervals-2026-10-bad.jsonl'), '\u0000\u0000 garbage\nnull\n[]\n{"start":"x"}\n{"start":5,"end":3}\n');
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    store.append(iv(at(8, 10), at(8, 11)));
    store.flush();
    node_assert_1.default.strictEqual(store.read((0, stats_1.dayRange)(at(8, 12))).length, 1);
});
(0, node_test_1.test)('an interval crossing a month end is split across two files; lines stay on the first piece', () => {
    const dir = tmpDir();
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    store.append(iv(at(31, 23, 50), at(1, 0, 10, 10), { linesAdded: 3 }));
    store.flush();
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-11-w1.jsonl']);
    const got = store.read({ from: at(1, 0), to: at(30, 0, 0, 10) }).sort(byStart);
    node_assert_1.default.deepStrictEqual(got.map((i) => [i.start, i.end, i.linesAdded]), [[at(31, 23, 50), at(1, 0, 0, 10), 3], [at(1, 0, 0, 10), at(1, 0, 10, 10), 0]]);
});
(0, node_test_1.test)('deleteRange removes overlapping intervals (flushed and buffered) and empty files', () => {
    const dir = tmpDir();
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    store.append(iv(at(7, 10), at(7, 11)));
    store.append(iv(at(8, 10), at(8, 11)));
    store.append(iv(at(8, 23, 30), at(9, 0, 30)));
    store.append(iv(at(9, 10), at(9, 11)));
    store.flush();
    store.append(iv(at(8, 14), at(8, 15))); // still buffered
    store.deleteRange((0, stats_1.dayRange)(at(8, 12)));
    const left = store.read({ from: 0, to: Number.MAX_SAFE_INTEGER }).sort(byStart);
    node_assert_1.default.deepStrictEqual(left.map((i) => i.start), [at(7, 10), at(9, 10)]);
    const loneDir = tmpDir();
    const lone = new intervalStore_1.IntervalStore({ dir: loneDir, windowId: 'w1' });
    lone.append(iv(at(8, 10), at(8, 11)));
    lone.flush();
    lone.deleteRange((0, stats_1.dayRange)(at(8, 12)));
    node_assert_1.default.deepStrictEqual(fs.readdirSync(loneDir), []);
});
(0, node_test_1.test)('deleteAll removes every file and the buffer', () => {
    const dir = tmpDir();
    const a = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    const b = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    a.append(iv(at(8, 10), at(8, 11)));
    b.append(iv(at(9, 10), at(9, 11)));
    b.flush();
    a.flush();
    a.append(iv(at(10, 10), at(10, 11)));
    a.deleteAll();
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir), []);
    node_assert_1.default.deepStrictEqual(a.read({ from: 0, to: Number.MAX_SAFE_INTEGER }), []);
});
(0, node_test_1.test)('an unwritable storage dir logs, keeps the data in memory, never throws, and retries', () => {
    const dir = path.join(tmpDir(), 'blocked');
    fs.writeFileSync(dir, 'a file where the directory should be');
    const logs = [];
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1', log: (m) => logs.push(m) });
    store.append(iv(at(8, 10), at(8, 11)));
    node_assert_1.default.doesNotThrow(() => store.flush());
    node_assert_1.default.ok(logs.length > 0);
    node_assert_1.default.strictEqual(store.read((0, stats_1.dayRange)(at(8, 12))).length, 1, 'still readable from memory');
    fs.rmSync(dir);
    store.flush();
    node_assert_1.default.strictEqual(fs.readdirSync(dir).length, 1, 'retried successfully');
});
(0, node_test_1.test)('the in-memory buffer is capped, dropping the oldest', () => {
    const dir = path.join(tmpDir(), 'blocked');
    fs.writeFileSync(dir, 'x');
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1', maxBuffered: 2, log: () => { } });
    store.append(iv(at(8, 10), at(8, 11)));
    store.append(iv(at(8, 12), at(8, 13)));
    store.append(iv(at(8, 14), at(8, 15)));
    const got = store.read((0, stats_1.dayRange)(at(8, 12))).sort(byStart);
    node_assert_1.default.deepStrictEqual(got.map((i) => i.start), [at(8, 12), at(8, 14)]);
});
(0, node_test_1.test)('replaceWindow swaps one window\'s files, splits months, can be repeated and can empty the window', () => {
    const dir = tmpDir();
    const native = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    native.append(iv(at(8, 9), at(8, 10)));
    native.flush();
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    node_assert_1.default.strictEqual(store.hasWindow('import-wakatime'), false);
    store.replaceWindow('import-wakatime', [iv(at(8, 10), at(8, 11)), iv(at(30, 23, 0, 8), at(1, 1, 0, 9))]);
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir).sort(), [
        'intervals-2026-09-import-wakatime.jsonl',
        'intervals-2026-10-import-wakatime.jsonl',
        'intervals-2026-10-w1.jsonl',
    ]);
    node_assert_1.default.strictEqual(store.hasWindow('import-wakatime'), true);
    store.replaceWindow('import-wakatime', [iv(at(8, 12), at(8, 13))]);
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-import-wakatime.jsonl', 'intervals-2026-10-w1.jsonl']);
    const all = { from: -Infinity, to: Infinity };
    node_assert_1.default.deepStrictEqual(store.read(all).sort(byStart).map((i) => i.start), [at(8, 9), at(8, 12)]);
    store.replaceWindow('import-wakatime', []);
    node_assert_1.default.strictEqual(store.hasWindow('import-wakatime'), false);
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir), ['intervals-2026-10-w1.jsonl']);
});
(0, node_test_1.test)('replaceWindow keeps every interval even beyond maxBuffered', () => {
    const store = new intervalStore_1.IntervalStore({ dir: tmpDir(), windowId: 'w1', maxBuffered: 10 });
    const many = Array.from({ length: 2_000 }, (_, n) => iv(at(8, 0) + n * 120_000, at(8, 0) + n * 120_000 + 60_000));
    store.replaceWindow('import-wakatime', many);
    node_assert_1.default.strictEqual(store.read({ from: -Infinity, to: Infinity }).length, 2_000);
});
(0, node_test_1.test)('read tags every interval with its window: files by file name, the unflushed buffer with its own id', () => {
    const dir = tmpDir();
    const a = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    const b = new intervalStore_1.IntervalStore({ dir, windowId: 'w2' });
    a.append(iv(at(8, 10), at(8, 11)));
    a.flush();
    b.append(iv(at(8, 12), at(8, 13)));
    fs.writeFileSync(path.join(dir, 'intervals-2026-10-import-wakatime.jsonl'), JSON.stringify(iv(at(8, 14), at(8, 15))) + '\n');
    const got = a.read((0, stats_1.dayRange)(at(8, 12))).sort(byStart);
    node_assert_1.default.deepStrictEqual(got.map((i) => i.window), ['w1', 'import-wakatime'], 'a does not see the unflushed buffer of b');
    const own = b.read((0, stats_1.dayRange)(at(8, 12))).sort(byStart);
    node_assert_1.default.deepStrictEqual(own.map((i) => i.window), ['w1', 'w2', 'import-wakatime']);
    node_assert_1.default.strictEqual(b.windowId, 'w2');
});
(0, node_test_1.test)('the window tag is never written to disk, not even by deleteRange', () => {
    const dir = tmpDir();
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1' });
    store.append(iv(at(8, 10), at(8, 11)));
    store.append(iv(at(9, 10), at(9, 11)));
    store.flush();
    store.deleteRange((0, stats_1.dayRange)(at(9, 12)));
    const text = fs.readFileSync(path.join(dir, 'intervals-2026-10-w1.jsonl'), 'utf8');
    node_assert_1.default.ok(!text.includes('"window"'), text);
    node_assert_1.default.strictEqual(store.read({ from: at(1, 0), to: at(30, 0) }).length, 1);
});
(0, node_test_1.test)('newWindowId yields a fresh filename-safe id on every call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => (0, intervalStore_1.newWindowId)()));
    node_assert_1.default.strictEqual(ids.size, 50);
    node_assert_1.default.ok([...ids].every((id) => /^[0-9a-f]{10}$/.test(id)));
});
(0, node_test_1.test)('own data is tagged with the machine; cached data of another machine is read, tagged and replaced wholesale', () => {
    const dir = tmpDir();
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1', machineId: 'aaaaaaaaaa' });
    store.append(iv(at(8, 10), at(8, 11)));
    store.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 12), at(8, 13), { window: 'x1' })]);
    const day = (0, stats_1.dayRange)(at(8, 12));
    node_assert_1.default.deepStrictEqual(store.read(day).sort(byStart).map((i) => [i.machine, i.window]), [['aaaaaaaaaa', 'w1'], ['bbbbbbbbbb', 'x1']]);
    store.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 14), at(8, 15))]);
    node_assert_1.default.deepStrictEqual(store.read(day).filter((i) => i.machine === 'bbbbbbbbbb').map((i) => [i.start, i.window]), [[at(8, 14), '']]);
    node_assert_1.default.deepStrictEqual(store.remoteMonths(), [{ machine: 'bbbbbbbbbb', month: '2026-10' }]);
    node_assert_1.default.deepStrictEqual(store.read((0, stats_1.dayRange)(at(8, 12, 0, 10))), [], 'other months are not read');
    store.removeRemote('bbbbbbbbbb', '2026-10');
    node_assert_1.default.deepStrictEqual(store.remoteMonths(), []);
});
(0, node_test_1.test)('deleting data only touches this machine; exportOwn lists every window of a month with its window id', () => {
    const dir = tmpDir();
    const a = new intervalStore_1.IntervalStore({ dir, windowId: 'w1', machineId: 'aaaaaaaaaa' });
    const b = new intervalStore_1.IntervalStore({ dir, windowId: 'w2', machineId: 'aaaaaaaaaa' });
    a.append(iv(at(8, 10), at(8, 11)));
    b.append(iv(at(8, 12), at(8, 13)));
    a.append(iv(at(8, 10, 0, 10), at(8, 11, 0, 10)));
    a.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 12), at(8, 13))]);
    node_assert_1.default.deepStrictEqual(a.ownMonths(), ['2026-10', '2026-11']);
    node_assert_1.default.deepStrictEqual(a.exportOwn('2026-10').map((i) => i.window).sort(), ['w1']);
    b.flush();
    node_assert_1.default.deepStrictEqual(a.exportOwn('2026-10').map((i) => i.window).sort(), ['w1', 'w2']);
    a.deleteAll();
    node_assert_1.default.deepStrictEqual(a.ownMonths(), []);
    node_assert_1.default.strictEqual(a.read({ from: -Infinity, to: Infinity }).length, 1, 'the other machine survives');
});
(0, node_test_1.test)('replaceRemote rejects ids and months that could escape the cache folder', () => {
    const store = new intervalStore_1.IntervalStore({ dir: tmpDir(), windowId: 'w1' });
    for (const [machine, month] of [['../../x', '2026-10'], ['aaaaaaaaaa', '../2026'], ['AAAAAAAAAA', '2026-10']]) {
        node_assert_1.default.throws(() => store.replaceRemote(machine, month, []), /invalid/);
    }
});
//# sourceMappingURL=intervalStore.test.js.map