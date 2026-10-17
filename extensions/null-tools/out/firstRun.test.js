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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
const firstRun_1 = require("./firstRun");
class FakeHost {
    text;
    userValues;
    opts;
    removed = 0;
    set = [];
    installs = [];
    logs = [];
    constructor(text, userValues = [], opts = {}) {
        this.text = text;
        this.userValues = userValues;
        this.opts = opts;
    }
    read() { return this.text; }
    remove() { this.removed++; }
    hasUserValue(key) { return this.userValues.includes(key); }
    async setSetting(key, value) {
        if (key === this.opts.failSet) {
            throw new Error('settings.json is invalid');
        }
        this.set.push([key, value]);
    }
    async installExtension(id) {
        this.installs.push(id);
        if (this.opts.hangInstall?.includes(id)) {
            return new Promise(() => { });
        }
        if (this.opts.failInstall?.includes(id)) {
            throw new Error('offline');
        }
    }
    log(message) { this.logs.push(message); }
}
const file = (o) => JSON.stringify({ schema: 1, ...o });
(0, node_test_1.default)('the allowlist matches the settings table the installer validates against', () => {
    // out/ -> null-tools -> extensions -> repo root
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'setup', 'builtins.config.json'), 'utf8'));
    const defs = config.settings;
    node_assert_1.default.deepStrictEqual(Object.keys(firstRun_1.ALLOWED_SETTINGS).sort(), defs.map(d => d.key).sort());
    for (const d of defs) {
        const rule = firstRun_1.ALLOWED_SETTINGS[d.key];
        node_assert_1.default.ok(rule(d.default), `${d.key}: default`);
        for (const o of d.options ?? []) {
            node_assert_1.default.ok(rule(o.value), `${d.key}=${o.value}`);
        }
        if (d.kind === 'choice') {
            node_assert_1.default.ok(!rule('definitely-not-an-option'), d.key);
        }
        if (d.kind === 'bool') {
            node_assert_1.default.ok(rule(true) && rule(false) && !rule('true') && !rule(1), d.key);
        }
        if (d.kind === 'number') {
            node_assert_1.default.ok(rule(d.min) && rule(d.max), `${d.key}: bounds`);
            node_assert_1.default.ok(!rule(d.min - 1) && !rule(d.max + 1) && !rule(String(d.min)), `${d.key}: outside`);
        }
        if (d.kind === 'text') {
            node_assert_1.default.ok(!rule('') && !rule('a\nb') && !rule('x'.repeat(201)), d.key);
        }
    }
});
// ── parseFirstRun ──────────────────────────────────────────────────────────
(0, node_test_1.default)('parseFirstRun reads the schema, tolerates a BOM and drops invalid extension ids', () => {
    const parsed = (0, firstRun_1.parseFirstRun)('\uFEFF' + file({ settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python', '../x', 'a', 7] }));
    node_assert_1.default.deepStrictEqual(parsed, { settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python'] });
    node_assert_1.default.deepStrictEqual((0, firstRun_1.parseFirstRun)(file({})), { settings: {}, extensions: [] });
});
(0, node_test_1.default)('parseFirstRun returns undefined for anything that is not a schema-1 object', () => {
    for (const bad of ['', '{nope', 'null', '[]', '"x"', '{"schema":2}', '{"settings":{}}']) {
        node_assert_1.default.strictEqual((0, firstRun_1.parseFirstRun)(bad), undefined, JSON.stringify(bad));
    }
});
// ── runFirstRun ────────────────────────────────────────────────────────────
(0, node_test_1.default)('applies allowlisted settings the user has no value for, then deletes the file', async () => {
    const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }));
    const result = await (0, firstRun_1.runFirstRun)(host, 50);
    node_assert_1.default.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay'], ['editor.fontSize', 15]]);
    node_assert_1.default.deepStrictEqual(result?.applied, ['files.autoSave', 'editor.fontSize']);
    node_assert_1.default.strictEqual(host.removed, 1);
});
(0, node_test_1.default)('never overwrites a value the user already set, even a falsy one', async () => {
    const host = new FakeHost(file({ settings: { 'editor.formatOnSave': true, 'editor.fontSize': 15 } }), ['editor.formatOnSave']);
    const result = await (0, firstRun_1.runFirstRun)(host, 50);
    node_assert_1.default.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
    node_assert_1.default.deepStrictEqual(result?.kept, ['editor.formatOnSave']);
});
(0, node_test_1.default)('ignores keys outside the allowlist, prototype keys and invalid values', async () => {
    const raw = '{"schema":1,"settings":{"__proto__":{"x":1},"constructor":"y","toString":"z",'
        + '"terminal.integrated.shell.windows":"C:\\\\evil.exe","editor.fontSize":"huge","files.autoSave":"afterDelay"}}';
    const host = new FakeHost(raw);
    const result = await (0, firstRun_1.runFirstRun)(host, 50);
    node_assert_1.default.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay']]);
    node_assert_1.default.deepStrictEqual(result?.applied, ['files.autoSave']);
    node_assert_1.default.strictEqual(host.removed, 1);
});
(0, node_test_1.default)('an unusable file is discarded once without throwing or touching anything', async () => {
    for (const bad of ['', '{nope', '{"schema":2,"settings":{"files.autoSave":"off"}}', '[]']) {
        const host = new FakeHost(bad);
        node_assert_1.default.strictEqual(await (0, firstRun_1.runFirstRun)(host, 50), undefined);
        node_assert_1.default.strictEqual(host.removed, 1, JSON.stringify(bad));
        node_assert_1.default.deepStrictEqual([host.set, host.installs], [[], []]);
    }
});
(0, node_test_1.default)('no file means nothing happens', async () => {
    const host = new FakeHost(undefined);
    node_assert_1.default.strictEqual(await (0, firstRun_1.runFirstRun)(host, 50), undefined);
    node_assert_1.default.deepStrictEqual([host.removed, host.set, host.installs], [0, [], []]);
});
(0, node_test_1.default)('a failed settings write keeps the file for the next launch and does not stop the others', async () => {
    const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }), [], { failSet: 'files.autoSave' });
    const result = await (0, firstRun_1.runFirstRun)(host, 50);
    node_assert_1.default.deepStrictEqual(result?.failedSettings, ['files.autoSave']);
    node_assert_1.default.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
    node_assert_1.default.strictEqual(host.removed, 0);
});
(0, node_test_1.default)('extensions install one at a time in order; a failure or a hang does not stop the rest or keep the file', async () => {
    const host = new FakeHost(file({ extensions: ['a.one', 'b.two', 'c.three', 'd.four'] }), [], { failInstall: ['b.two'], hangInstall: ['c.three'] });
    const result = await (0, firstRun_1.runFirstRun)(host, 20);
    node_assert_1.default.deepStrictEqual(host.installs, ['a.one', 'b.two', 'c.three', 'd.four']);
    node_assert_1.default.deepStrictEqual(result?.failedExtensions, ['b.two', 'c.three']);
    node_assert_1.default.strictEqual(host.removed, 1);
    node_assert_1.default.ok(host.logs.some(l => /c\.three.*timed out/.test(l)));
});
(0, node_test_1.default)('installAll returns exactly the ids that failed (the Retry path)', async () => {
    const host = new FakeHost(undefined, [], { failInstall: ['x.y'] });
    node_assert_1.default.deepStrictEqual(await (0, firstRun_1.installAll)(host, ['p.q', 'x.y'], 20), ['x.y']);
    node_assert_1.default.deepStrictEqual(await (0, firstRun_1.installAll)(host, [], 20), []);
});
//# sourceMappingURL=firstRun.test.js.map