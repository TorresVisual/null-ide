'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const reportStore_1 = require("../reportStore");
function memFs() {
    const files = new Map();
    return {
        files,
        async mkdir() { },
        async readdir(dir) {
            return [...files.keys()].filter((k) => node_path_1.default.dirname(k) === node_path_1.default.normalize(dir)).map((k) => node_path_1.default.basename(k));
        },
        async readFile(f) {
            const v = files.get(f);
            if (v === undefined)
                throw new Error('ENOENT');
            return v;
        },
        async writeFile(f, d) {
            files.set(f, d);
        },
        async unlink(f) {
            files.delete(f);
        },
    };
}
const report = (id, takenAt) => ({
    schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1', initialStartup: true, partial: false,
    headlineMs: 1000, milestones: [], phases: [], extensions: [],
});
const make = (retention = 20) => {
    const fs = memFs();
    const logs = [];
    return { fs, logs, store: new reportStore_1.ReportStore({ dir: '/reports', fs, retention: () => retention, log: (m) => logs.push(m) }) };
};
(0, node_test_1.test)('save then list returns newest first and rewriting an id replaces it', async () => {
    const { store } = make();
    await store.save(report('a', 100));
    await store.save(report('b', 300));
    await store.save(report('c', 200));
    await store.save({ ...report('a', 100), headlineMs: 42 });
    const all = await store.list();
    node_assert_1.default.deepStrictEqual(all.map((r) => r.id), ['b', 'c', 'a']);
    node_assert_1.default.strictEqual(all[2].headlineMs, 42);
});
(0, node_test_1.test)('save prunes the oldest reports beyond the retention limit', async () => {
    const { store } = make(2);
    for (const [id, t] of [['a', 1], ['b', 2], ['c', 3]])
        await store.save(report(id, t));
    node_assert_1.default.deepStrictEqual((await store.list()).map((r) => r.id), ['c', 'b']);
});
(0, node_test_1.test)('corrupt, truncated and future-version files are skipped and never deleted', async () => {
    const { store, fs } = make(1);
    fs.files.set(node_path_1.default.join('/reports', 'bad.json'), '{ not json');
    fs.files.set(node_path_1.default.join('/reports', 'future.json'), JSON.stringify({ ...report('f', 1), schemaVersion: 99 }));
    fs.files.set(node_path_1.default.join('/reports', 'notes.txt'), 'x');
    await store.save(report('a', 10));
    await store.save(report('b', 20));
    node_assert_1.default.deepStrictEqual((await store.list()).map((r) => r.id), ['b']);
    node_assert_1.default.ok(fs.files.has(node_path_1.default.join('/reports', 'bad.json')));
    node_assert_1.default.ok(fs.files.has(node_path_1.default.join('/reports', 'future.json')));
    node_assert_1.default.ok(fs.files.has(node_path_1.default.join('/reports', 'notes.txt')));
});
(0, node_test_1.test)('an unsafe id cannot escape the reports folder', async () => {
    const { store, fs } = make();
    await store.save(report('../../evil', 1));
    node_assert_1.default.ok([...fs.files.keys()].every((k) => node_path_1.default.dirname(k) === node_path_1.default.normalize('/reports')));
});
(0, node_test_1.test)('clear removes the stored reports', async () => {
    const { store } = make();
    await store.save(report('a', 1));
    await store.clear();
    node_assert_1.default.deepStrictEqual(await store.list(), []);
});
(0, node_test_1.test)('a missing folder lists as empty', async () => {
    const fs = memFs();
    fs.readdir = async () => { throw new Error('ENOENT'); };
    const store = new reportStore_1.ReportStore({ dir: '/nope', fs, retention: () => 5, log: () => { } });
    node_assert_1.default.deepStrictEqual(await store.list(), []);
});
//# sourceMappingURL=reportStore.test.js.map