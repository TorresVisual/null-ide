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
const cli_1 = require("./cli");
const ROOT = 'C:\\UE';
function tempDir(files = ['MyGame.uproject']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-cli-'));
    for (const f of files)
        fs.writeFileSync(path.join(dir, f), '{"EngineAssociation":"5.8"}');
    return dir;
}
// Fake engine: every path "exists", so --engine always resolves.
const engineFound = { registry: () => undefined, readFile: () => undefined, exists: () => true };
function deps(cwd, o = {}) {
    const lines = [];
    const d = {
        cwd,
        project: cli_1.realProjectFs,
        engine: o.engine ?? engineFound,
        run: async (plan) => {
            o.plans?.push(plan);
            return { code: 0, timedOut: false, seconds: 1, ...o.result };
        },
        now: () => new Date(2026, 0, 2, 3, 4, 5),
        out: (l) => lines.push(l),
        err: (l) => lines.push(l),
        exp: { fs: cli_1.realExportFs, lock: cli_1.realLockIo, scriptPath: 'export_asset.py' },
        readLog: cli_1.realExportFs.readFile,
        lines,
    };
    return d;
}
(0, node_test_1.test)('the engine exit code passes through', async () => {
    const d = deps(tempDir(), { result: { code: 3 } });
    assert.equal(await (0, cli_1.main)(['smoke', '--engine', ROOT], d), 3);
    assert.ok(d.lines.some((l) => l.startsWith('null-unreal smoke: exit 3')));
});
(0, node_test_1.test)('a timeout returns 124', async () => {
    const d = deps(tempDir(), { result: { code: null, timedOut: true } });
    assert.equal(await (0, cli_1.main)(['smoke', '--engine', ROOT], d), 124);
});
(0, node_test_1.test)('a process killed by a signal returns 255, never 0', async () => {
    const d = deps(tempDir(), { result: { code: null } });
    assert.equal(await (0, cli_1.main)(['build', '--engine', ROOT], d), 255);
});
(0, node_test_1.test)('an unknown command is a usage error (2)', async () => {
    const d = deps(tempDir());
    assert.equal(await (0, cli_1.main)(['bogus'], d), 2);
    assert.ok(d.lines.some((l) => l.includes('usage')));
});
(0, node_test_1.test)('no .uproject in the given directory is a resolution error (2) naming --project', async () => {
    const empty = tempDir([]);
    const d = deps(empty);
    assert.equal(await (0, cli_1.main)(['smoke', '--project', empty, '--engine', ROOT], d), 2);
    assert.ok(d.lines.some((l) => l.includes('--project')));
});
(0, node_test_1.test)('two .uproject files in one directory is a resolution error (2) listing both', async () => {
    const two = tempDir(['A.uproject', 'B.uproject']);
    const d = deps(two);
    assert.equal(await (0, cli_1.main)(['smoke', '--project', two, '--engine', ROOT], d), 2);
    assert.ok(d.lines.some((l) => l.includes('A.uproject') && l.includes('B.uproject')));
});
(0, node_test_1.test)('a missing engine is a resolution error (2) with the actionable message', async () => {
    const dir = tempDir();
    const d = deps(dir, { engine: { registry: () => undefined, readFile: () => undefined, exists: () => false } });
    assert.equal(await (0, cli_1.main)(['smoke', '--project', dir], d), 2);
    assert.ok(d.lines.some((l) => l.includes('could not find Unreal Engine')));
});
(0, node_test_1.test)('arguments after -- are appended after the defaults, and --timeout overrides the timeout', async () => {
    const plans = [];
    const d = deps(tempDir(), { plans });
    await (0, cli_1.main)(['smoke', '--engine', ROOT, '--timeout', '7', '--', '-LogCmds=Foo'], d);
    assert.equal(plans[0].args[plans[0].args.length - 1], '-LogCmds=Foo');
    assert.equal(plans[0].timeoutSec, 7);
});
(0, node_test_1.test)('a run opens its log in Saved/NullUnreal and prints the path', async () => {
    const dir = tempDir();
    const d = deps(dir);
    await (0, cli_1.main)(['smoke', '--engine', ROOT], d);
    const logPath = path.join(dir, 'Saved', 'NullUnreal', 'smoke-20260102-030405.log');
    assert.ok(fs.existsSync(logPath), 'log file exists');
    assert.ok(d.lines.includes(`log: ${logPath}`));
});
// An engine folder with a Build.version and a project holding one asset; `run` plays the export script.
function exportSetup() {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'Content'));
    fs.writeFileSync(path.join(dir, 'Content', 'T.uasset'), 'abc');
    const engineRoot = path.join(dir, 'UE');
    fs.mkdirSync(path.join(engineRoot, 'Engine', 'Build'), { recursive: true });
    fs.writeFileSync(path.join(engineRoot, 'Engine', 'Build', 'Build.version'), '{"MajorVersion":5,"MinorVersion":8,"PatchVersion":4}');
    const d = deps(dir);
    d.run = async (plan) => {
        const req = JSON.parse(fs.readFileSync(plan.env.NULL_UNREAL_REQUEST, 'utf8'));
        const a = req.assets[0];
        const file = path.join(req.outputDir, 'Game', 'T.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({
            schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: a.package,
            kind: 'texture', class: 'Texture2D', references: { dependencies: [] }, data: { width: 8, height: 4, compression: 'TC_DEFAULT' }, sidecars: {},
        }));
        fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets: { [a.package]: { status: 'exported' } } }));
        return { code: 0, timedOut: false, seconds: 1 };
    };
    const err = [];
    d.err = (l) => err.push(l);
    return { dir, engineRoot, d, err };
}
(0, node_test_1.test)('export without an asset is a usage error (2)', async () => {
    const d = deps(tempDir());
    assert.equal(await (0, cli_1.main)(['export', '--engine', ROOT], d), 2);
    assert.ok(d.lines.some((l) => l.includes('at least one')));
});
(0, node_test_1.test)('export prints one line per asset and the result lines, then serves the second call from the cache', async () => {
    const { dir, engineRoot, d } = exportSetup();
    assert.equal(await (0, cli_1.main)(['export', path.join('Content', 'T.uasset'), '--engine', engineRoot], d), 0);
    assert.ok(d.lines.includes('/Game/T  texture  exported  Texture 8x4, TC_DEFAULT'), d.lines.join('\n'));
    assert.ok(d.lines.some((l) => l.startsWith('null-unreal export: exit 0')));
    assert.ok(d.lines.some((l) => l.startsWith('log: ') && l.includes('export-')));
    d.lines.length = 0;
    assert.equal(await (0, cli_1.main)(['export', path.join(dir, 'Content'), '--engine', engineRoot], d), 0);
    assert.ok(d.lines.includes('/Game/T  texture  cached  Texture 8x4, TC_DEFAULT'));
    assert.ok(d.lines.some((l) => l.includes('served from the cache')));
});
(0, node_test_1.test)('export --json puts only the JSON on stdout and the human lines on stderr', async () => {
    const { engineRoot, d, err } = exportSetup();
    assert.equal(await (0, cli_1.main)(['export', path.join('Content', 'T.uasset'), '--json', '--engine', engineRoot], d), 0);
    assert.equal(JSON.parse(d.lines.join('\n')).package, '/Game/T');
    assert.ok(err.some((l) => l.startsWith('/Game/T  texture  exported')));
});
(0, node_test_1.test)('export --json of several assets prints an array', async () => {
    const { dir, engineRoot, d } = exportSetup();
    fs.writeFileSync(path.join(dir, 'Content', 'U.uasset'), 'abcd');
    d.run = async (plan) => {
        const req = JSON.parse(fs.readFileSync(plan.env.NULL_UNREAL_REQUEST, 'utf8'));
        const assets = {};
        for (const a of req.assets) {
            const file = path.join(req.outputDir, ...a.package.split('/').filter(Boolean)) + '.json';
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify({
                schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: a.package,
                kind: 'generic', class: 'Thing', references: { dependencies: [] }, data: {}, sidecars: {},
            }));
            assets[a.package] = { status: 'exported' };
        }
        fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets }));
        return { code: 0, timedOut: false, seconds: 1 };
    };
    assert.equal(await (0, cli_1.main)(['export', path.join(dir, 'Content'), '--json', '--engine', engineRoot], d), 0);
    assert.deepEqual(JSON.parse(d.lines.join('\n')).map((x) => x.package), ['/Game/T', '/Game/U']);
});
(0, node_test_1.test)('an asset outside any Content root is exit 2 with the reason', async () => {
    const { dir, engineRoot, d } = exportSetup();
    fs.writeFileSync(path.join(dir, 'Stray.uasset'), 'x');
    assert.equal(await (0, cli_1.main)(['export', 'Stray.uasset', '--engine', engineRoot], d), 2);
    assert.ok(d.lines.some((l) => l.includes('not a .uasset under')));
});
// A fake engine run that writes `text` to the log sink and exits with `code`.
function withOutput(d, text, code = 0) {
    d.run = async (_plan, sink) => {
        sink?.write(text);
        return { code, timedOut: false, seconds: 1 };
    };
}
(0, node_test_1.test)('exit 0 with a clean summary stays 0 and prints the summary after the result lines', async () => {
    const d = deps(tempDir());
    withOutput(d, 'LogInit: Display: PreExit Game.\n');
    assert.equal(await (0, cli_1.main)(['smoke', '--engine', ROOT], d), 0);
    assert.equal(d.lines[0], 'null-unreal smoke: exit 0 in 1s');
    assert.equal(d.lines[d.lines.length - 1], 'smoke passed');
});
(0, node_test_1.test)('exit 0 whose summary proves a failure becomes 1 and the result line says so', async () => {
    const d = deps(tempDir());
    withOutput(d, 'LogWindows: Error: appError called: Fatal error: boom\n');
    assert.equal(await (0, cli_1.main)(['smoke', '--engine', ROOT], d), 1);
    assert.equal(d.lines[0], 'null-unreal smoke: exit 1 in 1s');
    assert.ok(d.lines.includes('smoke failed: fatal error at startup'));
});
(0, node_test_1.test)('exit 0 with output nothing recognises becomes 1 and prints the tail', async () => {
    const d = deps(tempDir());
    withOutput(d, 'one\ntwo\n');
    assert.equal(await (0, cli_1.main)(['build', '--engine', ROOT], d), 1);
    assert.ok(d.lines.some((l) => l.startsWith('could not summarize')));
    assert.ok(d.lines.includes('two'));
});
(0, node_test_1.test)('a non-zero engine exit passes through unchanged, with the summary', async () => {
    const d = deps(tempDir());
    withOutput(d, 'a.cpp(1,2): error C2065: x\nAutomationTool exiting with ExitCode=6 (6)\n', 6);
    assert.equal(await (0, cli_1.main)(['build', '--engine', ROOT], d), 6);
    assert.ok(d.lines.includes('build failed: 1 error, AutomationTool exit 6'));
});
(0, node_test_1.test)('a timeout keeps 124 and still summarizes what was logged', async () => {
    const d = deps(tempDir());
    d.run = async (_plan, sink) => {
        sink?.write('LogAutomationController: Display: Test Started. Name={A} Path={X.A}\n');
        return { code: null, timedOut: true, seconds: 600 };
    };
    assert.equal(await (0, cli_1.main)(['test', '--engine', ROOT], d), 124);
    assert.ok(d.lines.some((l) => l.startsWith('null-unreal test: timed out')));
    assert.ok(d.lines.includes('HUNG X.A (started, never completed)'));
});
(0, node_test_1.test)('run prints only the result lines', async () => {
    const d = deps(tempDir());
    withOutput(d, 'anything');
    assert.equal(await (0, cli_1.main)(['run', '--engine', ROOT], d), 0);
    assert.equal(d.lines.length, 2);
});
(0, node_test_1.test)('compdb runs UnrealBuildTool and prints the database path', async () => {
    const plans = [];
    const d = deps(tempDir(), { plans });
    const run = d.run;
    d.run = async (plan, sink, echo) => {
        sink?.write('ClangDatabase written to C:\P\compile_commands.json\n\nResult: Succeeded\n');
        return run(plan, sink, echo);
    };
    assert.equal(await (0, cli_1.main)(['compdb', '--engine', ROOT], d), 0);
    assert.ok(plans[0].args.includes('-mode=GenerateClangDatabase'));
    assert.ok(d.lines.includes('compile database: C:\P\compile_commands.json'));
});
//# sourceMappingURL=cli.test.js.map