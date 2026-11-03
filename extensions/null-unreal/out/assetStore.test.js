"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const assetStore_1 = require("./assetStore");
const doc = (file) => ({ package: `/Game/${file}`, kind: 'texture' });
// A backend whose cache fills when a run finishes. `gate` holds a run open until released.
function backend(o = {}) {
    const cache = new Map();
    const runs = [];
    const b = {
        peek: (f) => cache.get(f),
        run: async (files, force) => {
            runs.push({ files, force });
            await o.gate;
            const errors = new Map();
            for (const f of files) {
                if (o.fail?.[f])
                    errors.set(f, o.fail[f]);
                else
                    cache.set(f, doc(f));
            }
            return errors;
        },
    };
    return { b, cache, runs };
}
(0, node_test_1.test)('a cache hit never reaches the engine', async () => {
    const { b, cache, runs } = backend();
    cache.set('a', doc('a'));
    const store = new assetStore_1.AssetStore(b);
    assert.equal(store.peek('a')?.package, '/Game/a');
    assert.equal((await store.get('a')).package, '/Game/a');
    assert.equal(runs.length, 0);
});
(0, node_test_1.test)('requests made in the same tick go out as one run', async () => {
    const { b, runs } = backend();
    const store = new assetStore_1.AssetStore(b);
    const r = await Promise.all([store.get('a'), store.get('b'), store.getMany(['c', 'd'])]);
    assert.equal(r.length, 3);
    assert.deepEqual(runs.map((x) => x.files), [['a', 'b', 'c', 'd']]);
});
(0, node_test_1.test)('a request for a file already exporting joins that run; new files queue into one next run', async () => {
    let release;
    const { b, runs } = backend({ gate: new Promise((r) => (release = r)) });
    const store = new assetStore_1.AssetStore(b);
    const first = store.get('a');
    await new Promise((r) => setTimeout(r, 0)); // the first run is now open
    const joined = store.get('a');
    const second = [store.get('b'), store.get('c')];
    release();
    await Promise.all([first, joined, ...second]);
    assert.deepEqual(runs.map((x) => x.files), [['a'], ['b', 'c']]);
});
(0, node_test_1.test)('state events go queued, exporting, ready per file', async () => {
    const { b } = backend();
    const store = new assetStore_1.AssetStore(b);
    const seen = [];
    store.onState((f, s) => seen.push(`${f}:${s.state}`));
    await store.get('a');
    assert.deepEqual(seen, ['a:queued', 'a:exporting', 'a:ready']);
});
(0, node_test_1.test)('a failed asset rejects get with the CLI error and emits failed; the others still succeed', async () => {
    const { b } = backend({ fail: { bad: 'KeyError: x' } });
    const store = new assetStore_1.AssetStore(b);
    const states = [];
    store.onState((f, s) => f === 'bad' && states.push(s));
    const [ok, bad] = await store.getMany(['good', 'bad']);
    assert.ok('doc' in ok);
    assert.deepEqual(bad, { file: 'bad', error: 'KeyError: x' });
    assert.deepEqual(states.at(-1), { state: 'failed', error: 'KeyError: x' });
    await assert.rejects(store.get('bad'), /KeyError: x/);
});
(0, node_test_1.test)('a backend that throws fails every file in the run with its message', async () => {
    const store = new assetStore_1.AssetStore({ peek: () => undefined, run: async () => { throw new Error('spawn failed'); } });
    await assert.rejects(store.get('a'), /spawn failed/);
});
(0, node_test_1.test)('force bypasses the cache and runs separately from ordinary requests', async () => {
    const { b, cache, runs } = backend();
    cache.set('a', doc('a'));
    const store = new assetStore_1.AssetStore(b);
    await Promise.all([store.get('a', { force: true }), store.get('b')]);
    assert.deepEqual(runs, [{ files: ['b'], force: false }, { files: ['a'], force: true }]);
});
//# sourceMappingURL=assetStore.test.js.map