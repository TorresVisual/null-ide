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
const path = __importStar(require("node:path"));
const summary_1 = require("./summary");
// Logs captured from UE 5.8 runs (scrubbed); out/ is two levels below the extension root.
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'logs', name), 'utf8');
(0, node_test_1.test)('a build with BUILD SUCCESSFUL and exit 0 is ok', () => {
    const s = (0, summary_1.summarizeBuild)(fixture('build-ok.txt'));
    assert.equal(s.verdict, 'ok');
});
(0, node_test_1.test)('build errors are listed once with a count, and the AutomationTool exit code is named', () => {
    const s = (0, summary_1.summarizeBuild)(fixture('build-fail.txt'));
    assert.equal(s.verdict, 'failed');
    assert.equal(s.lines[0], 'build failed: 2 errors, AutomationTool exit 6');
    assert.ok(s.lines.some((l) => l.includes('MyGameTests.cpp(16,19): error C2065') && l.endsWith('(x2)')), s.lines.join('\n'));
    assert.ok(s.lines.some((l) => l.includes('error C2440')));
});
(0, node_test_1.test)('a build log with no success marker and no errors is unknown, with the tail', () => {
    const s = (0, summary_1.summarizeBuild)('Starting AutomationTool...\nsomething else\n');
    assert.equal(s.verdict, 'unknown');
    assert.ok(s.lines[0].startsWith('could not summarize'));
    assert.ok(s.lines.includes('something else'));
});
(0, node_test_1.test)('a linker error and a UAT ERROR line count', () => {
    const s = (0, summary_1.summarizeBuild)('Foo.obj : error LNK2019: unresolved external symbol bar\nERROR: BuildCookRun failed\n');
    assert.equal(s.verdict, 'failed');
    assert.equal(s.lines.length, 3);
});
(0, node_test_1.test)('more than 30 distinct errors are capped with a pointer to the log', () => {
    const log = Array.from({ length: 35 }, (_, i) => `a.cpp(${i + 1}): error C1000: boom`).join('\n');
    const s = (0, summary_1.summarizeBuild)(log, 'X.txt');
    assert.equal(s.lines.length, 1 + 30 + 1);
    assert.equal(s.lines[31], '… 5 more, see X.txt');
});
(0, node_test_1.test)('passing tests are counted', () => {
    const s = (0, summary_1.summarizeTest)(fixture('test-ok.txt'));
    assert.deepEqual(s, { verdict: 'ok', lines: ['test passed: 2 passed, 0 failed'] });
});
(0, node_test_1.test)('failing tests are named with their error and warning lines', () => {
    const s = (0, summary_1.summarizeTest)(fixture('test-fail.txt'));
    assert.equal(s.verdict, 'failed');
    assert.equal(s.lines[0], 'test failed: 2 passed, 2 failed');
    assert.ok(s.lines.includes('FAIL MyGame.Broken.Fail (Fail)'));
    assert.ok(s.lines.some((l) => l.startsWith('  error: Expected \'two is three\' to be 3')));
    assert.ok(s.lines.some((l) => l.startsWith('  warning: heads up')));
    assert.ok(s.lines.some((l) => l.startsWith('  error: custom failure')));
});
(0, node_test_1.test)('a filter that matches nothing is a failure that says so', () => {
    const s = (0, summary_1.summarizeTest)(fixture('test-none.txt'));
    assert.equal(s.verdict, 'failed');
    assert.equal(s.lines[0], "test failed: no tests matched 'Nothing.Matches' (wrong --filter?)");
});
(0, node_test_1.test)('a test that started and never completed is reported as hung', () => {
    const log = 'LogAutomationController: Display: Test Started. Name={A} Path={X.A}\n';
    const s = (0, summary_1.summarizeTest)(log);
    assert.equal(s.verdict, 'failed');
    assert.ok(s.lines.includes('HUNG X.A (started, never completed)'));
});
(0, node_test_1.test)('a test log without any result is unknown', () => {
    assert.equal((0, summary_1.summarizeTest)('nothing useful\n').verdict, 'unknown');
});
(0, node_test_1.test)('a smoke run that shuts down cleanly is ok', () => {
    assert.equal((0, summary_1.summarizeSmoke)(fixture('smoke-ok.txt')).verdict, 'ok');
});
(0, node_test_1.test)('a smoke run with an appError is failed and shows the reason', () => {
    const s = (0, summary_1.summarizeSmoke)(fixture('smoke-crash.txt'));
    assert.equal(s.verdict, 'failed');
    assert.ok(s.lines[1].includes('Crashing the gamethread at your request'), s.lines.join('\n'));
});
(0, node_test_1.test)('a smoke log that ends before shutdown is unknown, never ok', () => {
    assert.equal((0, summary_1.summarizeSmoke)('LogInit: Display: starting\n').verdict, 'unknown');
});
(0, node_test_1.test)('compdb prints the database path', () => {
    const s = (0, summary_1.summarizeCompdb)(fixture('compdb-ok.txt'));
    assert.deepEqual(s, { verdict: 'ok', lines: ['compile database: D:\\Proj\\MyGame\\compile_commands.json'] });
});
(0, node_test_1.test)('compdb names the UBT failure', () => {
    const s = (0, summary_1.summarizeCompdb)(fixture('compdb-fail.txt'));
    assert.equal(s.verdict, 'failed');
    assert.ok(s.lines[0].startsWith('compdb failed: Failed (RulesError)'), s.lines[0]);
});
//# sourceMappingURL=summary.test.js.map