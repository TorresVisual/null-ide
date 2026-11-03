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
const node_stream_1 = require("node:stream");
const runner_1 = require("./runner");
// A sink that collects everything written to it.
function collector() {
    let buf = '';
    const sink = new node_stream_1.Writable({
        write(chunk, _enc, cb) {
            buf += String(chunk);
            cb();
        },
    });
    return { sink, text: () => buf };
}
function node(script, timeoutSec) {
    return { exe: process.execPath, args: ['-e', script], timeoutSec };
}
(0, node_test_1.test)('an exit code passes through and output reaches the sink', async () => {
    const c = collector();
    const r = await (0, runner_1.run)(node('process.stdout.write("hello"); process.exit(3)'), c.sink, false);
    assert.equal(r.code, 3);
    assert.equal(r.timedOut, false);
    assert.match(c.text(), /hello/);
});
(0, node_test_1.test)('a timeout kills the whole tree, including a grandchild', async () => {
    const c = collector();
    // The parent starts a grandchild, reports its pid, then sleeps too.
    const script = `
    const { spawn } = require('child_process');
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log('CHILD ' + g.pid);
    setInterval(() => {}, 1000);
  `;
    const r = await (0, runner_1.run)(node(script, 1), c.sink, false);
    assert.equal(r.timedOut, true);
    const pid = Number(/CHILD (\d+)/.exec(c.text())?.[1]);
    assert.ok(pid > 0, 'grandchild pid was reported');
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
        try {
            process.kill(pid, 0);
            await new Promise((d) => setTimeout(d, 100));
        }
        catch {
            alive = false;
        }
    }
    assert.equal(alive, false, 'grandchild must be gone after the timeout');
});
(0, node_test_1.test)('a nonexistent executable resolves with a null code instead of throwing', async () => {
    const c = collector();
    const r = await (0, runner_1.run)({ exe: 'C:\\no\\such\\engine.exe', args: [], timeoutSec: undefined }, c.sink, false);
    assert.equal(r.code, null);
    assert.equal(r.timedOut, false);
});
//# sourceMappingURL=runner.test.js.map