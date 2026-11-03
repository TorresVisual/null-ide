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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const cache_1 = require("./cache");
const cli_1 = require("./cli");
const exporter_1 = require("./exporter");
// A project with n assets A0..A(n-1) under Content, and a fake engine folder with a Build.version.
function setup(n = 2) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-export-'));
    const project = { file: path.join(root, 'G.uproject'), dir: root, name: 'G', engineAssociation: '5.8' };
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    const files = [];
    for (let i = 0; i < n; i++) {
        files.push(path.join(root, 'Content', `A${i}.uasset`));
        fs.writeFileSync(files[i], 'x'.repeat(10 + i));
    }
    const engineRoot = path.join(root, 'UE');
    fs.mkdirSync(path.join(engineRoot, 'Engine', 'Build'), { recursive: true });
    fs.writeFileSync(path.join(engineRoot, 'Engine', 'Build', 'Build.version'), '{"MajorVersion":5,"MinorVersion":8,"PatchVersion":4}');
    const engine = { root: engineRoot, editor: 'e', editorCmd: 'ec', automationTool: 'at' };
    return { root, project, engine, files };
}
const ok = { code: 0, timedOut: false, seconds: 1 };
// What the exporter script does for one asset, so the cache entry looks real.
function writeExport(req, pkg) {
    const a = req.assets.find((x) => x.package === pkg);
    const file = (0, cache_1.entryPath)(req.outputDir, pkg);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
        schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: pkg,
        kind: 'texture', class: 'Texture2D', references: { dependencies: [] }, data: { width: 1, height: 1 }, sidecars: {},
    }));
}
function deps(root, behave, calls = []) {
    return {
        fs: cli_1.realExportFs,
        lock: cli_1.realLockIo,
        now: () => new Date(2026, 0, 2, 3, 4, 5),
        scriptPath: 'export_asset.py',
        run: async (plan, sink) => {
            const req = JSON.parse(fs.readFileSync(plan.env.NULL_UNREAL_REQUEST, 'utf8'));
            calls.push(req);
            sink?.write('engine output\n');
            const b = behave(req, plan, calls.length);
            if (b.manifest)
                fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets: b.manifest }));
            return b.result ?? ok;
        },
    };
}
const exportsAll = (req) => {
    const manifest = {};
    for (const a of req.assets) {
        writeExport(req, a.package);
        manifest[a.package] = { status: 'exported' };
    }
    return { manifest };
};
const opts = (s, over = {}) => ({
    project: s.project, engine: s.engine, targets: s.files, force: false, extraArgs: [], ...over,
});
(0, node_test_1.test)('a miss runs the engine once for the whole batch and the second request is a pure cache hit', async () => {
    const s = setup(3);
    const calls = [];
    const first = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    assert.equal(first.code, 0);
    assert.deepEqual(first.outcomes.map((o) => [o.package, o.status]), [['/Game/A0', 'exported'], ['/Game/A1', 'exported'], ['/Game/A2', 'exported']]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assets.length, 3);
    assert.equal(calls[0].engineVersion, '5.8.4');
    const second = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    assert.equal(calls.length, 1, 'no second engine run');
    assert.equal(second.ran, false);
    assert.ok(second.outcomes.every((o) => o.status === 'hit'));
});
(0, node_test_1.test)('touching a source file makes only that asset a miss', async () => {
    const s = setup(2);
    const calls = [];
    await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    fs.writeFileSync(s.files[1], 'longer than before');
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    assert.deepEqual(r.outcomes.map((o) => o.status), ['hit', 'exported']);
    assert.deepEqual(calls[1].assets.map((a) => a.package), ['/Game/A1']);
});
(0, node_test_1.test)('--force ignores the cache', async () => {
    const s = setup(1);
    const calls = [];
    await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    const r = await (0, exporter_1.exportAssets)(opts(s, { force: true }), deps(s.root, exportsAll, calls));
    assert.equal(calls.length, 2);
    assert.equal(r.outcomes[0].status, 'exported');
});
(0, node_test_1.test)('a folder expands to its assets', async () => {
    const s = setup(2);
    const calls = [];
    await (0, exporter_1.exportAssets)(opts(s, { targets: [path.join(s.root, 'Content')] }), deps(s.root, exportsAll, calls));
    assert.equal(calls[0].assets.length, 2);
});
(0, node_test_1.test)('more than 50 assets split into runs of at most 50', async () => {
    const s = setup(exporter_1.MAX_PER_RUN + 1);
    const calls = [];
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll, calls));
    assert.deepEqual(calls.map((c) => c.assets.length), [exporter_1.MAX_PER_RUN, 1]);
    assert.equal(r.code, 0);
});
(0, node_test_1.test)('the timeout is 120 s plus 2 s per asset in the run, and --timeout overrides it', async () => {
    const s = setup(3);
    const seen = [];
    const b = (req, plan) => (seen.push(plan.timeoutSec), exportsAll(req, plan, 1));
    await (0, exporter_1.exportAssets)(opts(s), deps(s.root, b));
    await (0, exporter_1.exportAssets)(opts(s, { force: true, timeoutSec: 9 }), deps(s.root, b));
    assert.deepEqual(seen, [126, 9]);
});
(0, node_test_1.test)('an asset the script failed on is failed with its error and the exit code is 1', async () => {
    const s = setup(2);
    const b = (req) => {
        writeExport(req, '/Game/A0');
        return { manifest: { '/Game/A0': { status: 'exported' }, '/Game/A1': { status: 'failed', error: 'KeyError: x' } } };
    };
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, b));
    assert.equal(r.code, 1);
    assert.deepEqual(r.outcomes.map((o) => [o.status, o.error]), [['exported', undefined], ['failed', 'KeyError: x']]);
});
(0, node_test_1.test)('a crash mid-batch keeps what was written, reports the rest not exported, stops and does not retry', async () => {
    const s = setup(exporter_1.MAX_PER_RUN + 2);
    const calls = [];
    const b = (req) => {
        writeExport(req, req.assets[0].package);
        return { manifest: { [req.assets[0].package]: { status: 'exported' } }, result: { code: 3, timedOut: false, seconds: 1 } };
    };
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, b, calls));
    assert.equal(calls.length, 1, 'the second chunk is not attempted');
    assert.equal(r.code, 1);
    assert.equal(r.outcomes[0].status, 'exported');
    assert.ok(r.outcomes.slice(1).every((o) => o.status === 'not exported'));
});
(0, node_test_1.test)('a timeout returns 124 and says what stays cached', async () => {
    const s = setup(1);
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, () => ({ result: { code: null, timedOut: true, seconds: 5 } })));
    assert.equal(r.code, 124);
    assert.equal(r.timedOut, true);
    assert.match(r.message, /killed/);
});
(0, node_test_1.test)('no manifest is exit 2 with the classification of the log, and the log is kept', async () => {
    const s = setup(1);
    const r = await (0, exporter_1.exportAssets)(opts(s), deps(s.root, () => ({ result: { code: 1, timedOut: false, seconds: 1 } })));
    assert.equal(r.code, 2);
    assert.match(r.message, /null-unreal build/);
    assert.ok(r.logPath && fs.existsSync(r.logPath));
});
(0, node_test_1.test)('the request and manifest files are cleaned up after a run', async () => {
    const s = setup(1);
    await (0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll));
    const left = fs.readdirSync(path.join(s.root, 'Saved', 'NullUnreal')).filter((n) => n.startsWith('export-'));
    assert.deepEqual(left.filter((n) => !n.endsWith('.log')), []);
});
(0, node_test_1.test)('a .uasset outside the mounted content roots is an explicit error before any engine run', async () => {
    const s = setup(1);
    const stray = path.join(s.root, 'Stray.uasset');
    fs.writeFileSync(stray, 'x');
    const calls = [];
    await assert.rejects((0, exporter_1.exportAssets)(opts(s, { targets: [stray] }), deps(s.root, exportsAll, calls)), /not a \.uasset under/);
    assert.equal(calls.length, 0);
});
(0, node_test_1.test)('a missing engine version file is a resolution error', async () => {
    const s = setup(1);
    fs.rmSync(path.join(s.engine.root, 'Engine', 'Build', 'Build.version'));
    await assert.rejects((0, exporter_1.exportAssets)(opts(s), deps(s.root, exportsAll)), /engine version/);
});
(0, node_test_1.test)('classifyEngineFailure tells the three causes apart', () => {
    assert.match((0, exporter_1.classifyEngineFailure)('LogInit: Unable to find commandlet class PythonScript', 1), /PythonScriptPlugin/);
    assert.match((0, exporter_1.classifyEngineFailure)('LogPythonScriptCommandlet: Display: Running Python script: x.py', 0), /failed before writing its manifest/);
    assert.match((0, exporter_1.classifyEngineFailure)('LogInit: boot', 1), /exited \(code 1\).*null-unreal build/);
    assert.match((0, exporter_1.classifyEngineFailure)(undefined, null), /killed/);
});
//# sourceMappingURL=exporter.test.js.map