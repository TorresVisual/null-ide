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
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const activitySync_1 = require("../activitySync");
const intervalStore_1 = require("../intervalStore");
const at = (day, h, month = new Date().getMonth()) => new Date(new Date().getFullYear(), month, day, h).getTime();
const iv = (start, over = {}) => ({
    start, end: start + 30 * 60_000, project: { key: 'k', name: 'proj' }, language: 'rust', file: 'a.rs', linesAdded: 0, linesRemoved: 0, ...over,
});
const everything = { from: -Infinity, to: Infinity };
/** An in-memory stand-in for null-sync's syncActivity: one shared "Gist" of name to text; versions change with the text. */
class FakeRemote {
    files = new Map();
    available = true;
    failWrites = false;
    patches = 0;
    port() {
        return {
            syncActivity: async (exchange) => {
                if (!this.available)
                    return false;
                const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
                const writes = await exchange({
                    names: [...this.files].map(([name, text]) => ({ name, version: sha(text) })),
                    read: (name) => this.files.get(name),
                });
                if (this.failWrites)
                    return false;
                for (const [name, text] of Object.entries(writes)) {
                    this.patches++;
                    if (text === null)
                        this.files.delete(name);
                    else
                        this.files.set(name, text);
                }
                return true;
            },
        };
    }
}
function device(remote, id, name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-sync-'));
    const store = new intervalStore_1.IntervalStore({ dir, windowId: 'w1', machineId: id });
    let state = { uploaded: {}, pulled: {}, names: {} };
    let pulls = 0;
    const sync = new activitySync_1.ActivitySync({
        store,
        machine: { id, name: () => name },
        port: async () => remote.port(),
        state: { load: () => structuredClone(state), save: (s) => { state = s; } },
        onPulled: () => pulls++,
        log: () => { },
    });
    return { store, sync, state: () => state, pulls: () => pulls };
}
const A = 'aaaaaaaaaa', B = 'bbbbbbbbbb';
(0, node_test_1.test)('B receives what A recorded; repeating the sync changes nothing and never duplicates', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    const b = device(remote, B, 'Laptop');
    a.store.append(iv(at(8, 10)));
    await a.sync.run();
    await b.sync.run();
    node_assert_1.default.deepStrictEqual(b.store.read(everything).map((i) => i.machine), [A]);
    node_assert_1.default.strictEqual(b.state().names[A], 'Desk');
    const patches = remote.patches;
    await a.sync.run();
    await b.sync.run();
    await b.sync.run();
    node_assert_1.default.strictEqual(remote.patches, patches, 'nothing uploaded again');
    node_assert_1.default.strictEqual(b.store.read(everything).length, 1);
    node_assert_1.default.strictEqual(b.pulls(), 1);
});
(0, node_test_1.test)('both machines see each other, and a changed month replaces the cached copy', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    const b = device(remote, B, 'Laptop');
    a.store.append(iv(at(8, 10)));
    b.store.append(iv(at(9, 10)));
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    node_assert_1.default.deepStrictEqual(a.store.read(everything).map((i) => i.machine).sort(), [A, B]);
    a.store.append(iv(at(10, 10)));
    await a.sync.run();
    await b.sync.run();
    node_assert_1.default.strictEqual(b.store.read(everything).filter((i) => i.machine === A).length, 2);
    node_assert_1.default.strictEqual(b.store.read(everything).filter((i) => i.machine === B).length, 1);
});
(0, node_test_1.test)('deleting all data removes the blobs of that machine and the cache of them on the other', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    const b = device(remote, B, 'Laptop');
    a.store.append(iv(at(8, 10)));
    await a.sync.run();
    await b.sync.run();
    a.store.deleteAll();
    await a.sync.run();
    node_assert_1.default.strictEqual(remote.files.size, 0);
    await b.sync.run();
    node_assert_1.default.deepStrictEqual(b.store.read(everything), []);
});
(0, node_test_1.test)('an unreadable remote blob is skipped and the previous cache stays', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    const b = device(remote, B, 'Laptop');
    a.store.append(iv(at(8, 10)));
    await a.sync.run();
    await b.sync.run();
    const name = [...remote.files.keys()][0];
    remote.files.set(name, 'garbage');
    await b.sync.run();
    node_assert_1.default.strictEqual(b.store.read(everything).length, 1);
});
(0, node_test_1.test)('own blobs are never downloaded, and a name that is not exactly ours is ignored', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    remote.files.set('activity__../../x__2026-10.enc', 'x');
    remote.files.set('settings.json.enc', 'x');
    a.store.append(iv(at(8, 10)));
    await a.sync.run();
    node_assert_1.default.deepStrictEqual(a.store.remoteMonths(), []);
    node_assert_1.default.strictEqual(a.store.read(everything).length, 1);
});
(0, node_test_1.test)('when sync is unavailable or the upload fails nothing is lost and the upload is retried', async () => {
    const remote = new FakeRemote();
    const a = device(remote, A, 'Desk');
    a.store.append(iv(at(8, 10)));
    remote.available = false;
    await a.sync.run();
    node_assert_1.default.strictEqual(remote.files.size, 0);
    remote.available = true;
    remote.failWrites = true;
    await a.sync.run();
    node_assert_1.default.strictEqual(remote.files.size, 0);
    node_assert_1.default.deepStrictEqual(a.state().uploaded, {}, 'a failed upload is not remembered');
    remote.failWrites = false;
    await a.sync.run();
    node_assert_1.default.strictEqual(remote.files.size, 1);
});
(0, node_test_1.test)('a missing null-sync is a no-op', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-sync-'));
    const sync = new activitySync_1.ActivitySync({
        store: new intervalStore_1.IntervalStore({ dir, windowId: 'w1', machineId: A }),
        machine: { id: A, name: () => 'x' },
        port: async () => undefined,
        state: { load: () => ({ uploaded: {}, pulled: {}, names: {} }), save: () => node_assert_1.default.fail('no state without a sync') },
        onPulled: () => node_assert_1.default.fail('nothing pulled'),
        log: () => { },
    });
    await sync.run();
});
//# sourceMappingURL=activitySync.test.js.map