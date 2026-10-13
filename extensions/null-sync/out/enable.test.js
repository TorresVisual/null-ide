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
const enable_1 = require("./enable");
const fakeGist_1 = require("./fakeGist");
const layout_1 = require("./layout");
const PASS = 'correct horse battery staple';
const ME = { id: 'acc', username: 'me' };
function setup(gist, over = {}, prompts = {}) {
    const saved = {};
    const asked = { attempts: [] };
    const deps = {
        accounts: async () => [ME],
        token: async () => 'token',
        io: gist.io,
        categories: () => ['settings', 'keybindings', 'snippets'],
        savePassphrase: async (p) => { saved.passphrase = p; },
        setState: async (s) => { saved.state = s; },
        ...over,
    };
    const ui = {
        chooseAccount: async (accounts) => accounts[0],
        consent: async (categories) => { asked.consent = categories; return true; },
        newPassphrase: async () => PASS,
        existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return PASS; },
        firstSync: async () => 'each',
        ...prompts,
    };
    return { deps, ui, saved, asked };
}
(0, node_test_1.describe)('enable', () => {
    (0, node_test_1.it)('needs a github.com account', async () => {
        const { deps, ui } = setup(new fakeGist_1.FakeGist(), { accounts: async () => [] });
        const result = await (0, enable_1.enable)(deps, ui);
        assert.equal(!result.ok && /Add a GitHub account/.test(result.message), true);
    });
    (0, node_test_1.it)('creates the store on the first device and remembers the passphrase and the gist', async () => {
        const gist = new fakeGist_1.FakeGist();
        const { deps, ui, saved, asked } = setup(gist);
        assert.deepEqual(await (0, enable_1.enable)(deps, ui), { ok: true, firstSync: undefined });
        const [id] = gist.ids();
        assert.deepEqual(Object.keys(gist.files(id)), [layout_1.MANIFEST]);
        assert.deepEqual(saved.state, { gistId: id, accountId: 'acc', owner: 'me', base: {} });
        assert.equal(saved.passphrase, PASS);
        assert.deepEqual(asked.consent, ['settings', 'keybindings', 'snippets']);
    });
    (0, node_test_1.it)('cancelling at the consent step creates nothing', async () => {
        const gist = new fakeGist_1.FakeGist();
        const { deps, ui, saved } = setup(gist, {}, { consent: async () => false });
        assert.deepEqual(await (0, enable_1.enable)(deps, ui), { ok: false, message: enable_1.CANCELLED });
        assert.equal(gist.ids().length, 0);
        assert.equal(saved.state, undefined);
    });
    (0, node_test_1.it)('fails clearly when GitHub gives no token', async () => {
        const { deps, ui } = setup(new fakeGist_1.FakeGist(), { token: async () => undefined });
        const result = await (0, enable_1.enable)(deps, ui);
        assert.equal(!result.ok && /gist scope/.test(result.message), true);
    });
    (0, node_test_1.it)('asks which account when there are several', async () => {
        const other = { id: 'acc2', username: 'work' };
        const { deps, ui, saved } = setup(new fakeGist_1.FakeGist(), { accounts: async () => [ME, other] }, {
            chooseAccount: async (accounts) => accounts[1],
        });
        assert.equal((await (0, enable_1.enable)(deps, ui)).ok, true);
        assert.equal(saved.state?.accountId, 'acc2');
    });
    (0, node_test_1.it)('joins an existing store with the right passphrase, trying again after a wrong one', async () => {
        const gist = new fakeGist_1.FakeGist();
        assert.equal((await (0, enable_1.enable)(setup(gist).deps, setup(gist).ui)).ok, true);
        const { deps, ui, saved, asked } = setup(gist, {}, {
            existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return attempt === 1 ? 'a wrong passphrase!' : PASS; },
        });
        assert.deepEqual(await (0, enable_1.enable)(deps, ui), { ok: true, firstSync: undefined });
        assert.deepEqual(asked.attempts, [1, 2]);
        assert.equal(saved.passphrase, PASS);
    });
    (0, node_test_1.it)('gives up after three wrong passphrases and saves nothing', async () => {
        const gist = new fakeGist_1.FakeGist();
        assert.equal((await (0, enable_1.enable)(setup(gist).deps, setup(gist).ui)).ok, true);
        const { deps, ui, saved, asked } = setup(gist, {}, {
            existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return 'a wrong passphrase!'; },
        });
        const result = await (0, enable_1.enable)(deps, ui);
        assert.equal(!result.ok && /not the passphrase/.test(result.message), true);
        assert.deepEqual(asked.attempts, [1, 2, 3]);
        assert.deepEqual(saved, {});
    });
    (0, node_test_1.it)('asks how to resolve the first sync only when the store already has data', async () => {
        const gist = new fakeGist_1.FakeGist();
        assert.equal((await (0, enable_1.enable)(setup(gist).deps, setup(gist).ui)).ok, true);
        let asks = 0;
        const empty = setup(gist, {}, { firstSync: async () => { asks++; return 'cloud'; } });
        assert.deepEqual(await (0, enable_1.enable)(empty.deps, empty.ui), { ok: true, firstSync: undefined });
        assert.equal(asks, 0, 'a store with only a manifest has nothing to resolve');
        gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
        for (const [choice, expected] of [['cloud', 'cloud'], ['device', 'device'], ['each', undefined]]) {
            const s = setup(gist, {}, { firstSync: async () => choice });
            assert.deepEqual(await (0, enable_1.enable)(s.deps, s.ui), { ok: true, firstSync: expected }, choice);
        }
    });
    (0, node_test_1.it)('cancelling the first-sync question saves nothing', async () => {
        const gist = new fakeGist_1.FakeGist();
        assert.equal((await (0, enable_1.enable)(setup(gist).deps, setup(gist).ui)).ok, true);
        gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
        const { deps, ui, saved } = setup(gist, {}, { firstSync: async () => undefined });
        assert.deepEqual(await (0, enable_1.enable)(deps, ui), { ok: false, message: enable_1.CANCELLED });
        assert.deepEqual(saved, {});
    });
});
//# sourceMappingURL=enable.test.js.map