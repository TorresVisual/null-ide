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
const fakeGist_1 = require("./fakeGist");
const testDevice_1 = require("./testDevice");
(0, node_test_1.after)(testDevice_1.cleanup);
const PASS = 'correct horse battery staple';
async function two() {
    const gist = new fakeGist_1.FakeGist();
    const a = new testDevice_1.Device(gist);
    const b = new testDevice_1.Device(gist);
    a.write('settings.json', '{\n  "editor.fontSize": 14\n}\n');
    assert.equal((await a.enable(PASS)).ok, true);
    assert.equal((await b.enable(PASS, 'cloud')).ok, true);
    return { gist, a, b, id: gist.ids()[0] };
}
(0, node_test_1.describe)('syncActivity', () => {
    (0, node_test_1.it)('does nothing while the activity category is off (the default)', async () => {
        const { a, gist, id } = await two();
        let called = false;
        assert.equal(await a.engine.syncActivity(async () => { called = true; return {}; }), false);
        assert.equal(called, false);
        assert.equal(Object.keys(gist.files(id)).some((n) => n.startsWith('activity__')), false);
    });
    (0, node_test_1.it)('does nothing while sync itself is off or the lock is held', async () => {
        const { a } = await two();
        a.categories.activity = true;
        a.enabled = false;
        assert.equal(await a.engine.syncActivity(async () => ({})), false);
        a.enabled = true;
        a.locked = true;
        assert.equal(await a.engine.syncActivity(async () => ({})), false);
    });
    (0, node_test_1.it)('uploads encrypted blobs that the other device can read, and deletes them', async () => {
        const { a, b, gist, id } = await two();
        a.categories.activity = true;
        b.categories.activity = true;
        assert.equal(await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': 'hello' })), true);
        const stored = gist.files(id)['activity__aaaaaaaaaa__2026-10.enc'];
        assert.ok(stored && !stored.includes('hello'), 'the Gist holds ciphertext');
        let seen;
        assert.equal(await b.engine.syncActivity(async (remote) => {
            seen = { names: remote.names, text: remote.read('activity__aaaaaaaaaa__2026-10.enc') };
            return {};
        }), true);
        assert.deepEqual(seen.names.map((n) => n.name), ['activity__aaaaaaaaaa__2026-10.enc']);
        assert.equal(seen.text, 'hello');
        assert.equal(await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': null })), true);
        assert.equal('activity__aaaaaaaaaa__2026-10.enc' in gist.files(id), false);
    });
    (0, node_test_1.it)('a version changes when a blob changes and stays put when it does not', async () => {
        const { a } = await two();
        a.categories.activity = true;
        const name = 'activity__aaaaaaaaaa__2026-10.enc';
        const versions = [];
        const watch = async (remote) => {
            versions.push(remote.names.find((n) => n.name === name)?.version ?? '');
            return {};
        };
        await a.engine.syncActivity(async () => ({ [name]: 'one' }));
        await a.engine.syncActivity(watch);
        await a.engine.syncActivity(watch);
        await a.engine.syncActivity(async () => ({ [name]: 'two' }));
        await a.engine.syncActivity(watch);
        assert.equal(versions[0], versions[1]);
        assert.notEqual(versions[1], versions[2]);
    });
    (0, node_test_1.it)('only writes activity__ names, ignores oversized ones, and survives a throwing exchange', async () => {
        const { a, gist, id } = await two();
        a.categories.activity = true;
        const before = Object.keys(gist.files(id)).sort();
        const ok = await a.engine.syncActivity(async () => ({
            'settings.json.enc': 'overwrite attempt',
            'manifest.json': 'x',
            'activity__aaaaaaaaaa__2026-10.enc': 'x'.repeat(900_000),
        }));
        assert.equal(ok, true);
        assert.deepEqual(Object.keys(gist.files(id)).sort(), before, 'nothing was written');
        assert.equal(await a.engine.syncActivity(async () => { throw new Error('boom'); }), false);
        assert.equal(a.status.state, 'idle', 'the settings-sync status is untouched');
    });
    (0, node_test_1.it)('is false when the Gist is unreachable, and settings sync keeps ignoring activity files', async () => {
        const { a, b, gist, id } = await two();
        a.categories.activity = true;
        await a.engine.syncActivity(async () => ({ 'activity__aaaaaaaaaa__2026-10.enc': 'hello' }));
        gist.offline = true;
        assert.equal(await a.engine.syncActivity(async () => ({})), false);
        gist.offline = false;
        a.write('settings.json', '{\n  "editor.fontSize": 18\n}\n');
        await a.run();
        await b.run();
        assert.equal(b.status.state, 'idle');
        assert.deepEqual(b.status.conflicts, []);
        assert.match(b.read('settings.json'), /18/);
        assert.ok('activity__aaaaaaaaaa__2026-10.enc' in gist.files(id), 'the settings run left the blob alone');
    });
});
//# sourceMappingURL=activityBlobs.test.js.map