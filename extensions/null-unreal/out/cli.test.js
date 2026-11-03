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
//# sourceMappingURL=cli.test.js.map