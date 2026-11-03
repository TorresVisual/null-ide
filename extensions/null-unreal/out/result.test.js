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
const result_1 = require("./result");
(0, node_test_1.test)('a finished run prints the result line and the log path', () => {
    const out = (0, result_1.formatResult)('test', { code: 0, timedOut: false, seconds: 12.4 }, 'C:\\My Games\\Saved\\NullUnreal\\test-1.log');
    assert.equal(out, 'null-unreal test: exit 0 in 12s\nlog: C:\\My Games\\Saved\\NullUnreal\\test-1.log');
});
(0, node_test_1.test)('parseLogPath round-trips a path with spaces', () => {
    const logPath = 'C:\\My Games\\Saved\\NullUnreal\\smoke-20260102-030405.log';
    const out = (0, result_1.formatResult)('smoke', { code: 0, timedOut: false, seconds: 3 }, logPath);
    assert.equal((0, result_1.parseLogPath)(out), logPath);
});
(0, node_test_1.test)('a run without a log prints the warning and parses to undefined', () => {
    const out = (0, result_1.formatResult)('run', { code: 0, timedOut: false, seconds: 1 }, undefined, 'could not create C:\\x');
    assert.equal(out.split('\n')[1], 'log: not kept (could not create C:\\x)');
    assert.equal((0, result_1.parseLogPath)(out), undefined);
});
(0, node_test_1.test)('a timeout prints timed out and the elapsed seconds', () => {
    const out = (0, result_1.formatResult)('smoke', { code: null, timedOut: true, seconds: 120.2 }, 'C:\\p\\smoke.log');
    assert.equal(out.split('\n')[0], 'null-unreal smoke: timed out after 120s');
});
(0, node_test_1.test)('a process killed by a signal reports 255, never 0', () => {
    assert.equal((0, result_1.formatResult)('build', { code: null, timedOut: false, seconds: 2 }, undefined, 'x').split('\n')[0], 'null-unreal build: exit 255 in 2s');
    assert.equal((0, result_1.exitCodeOf)({ code: null, timedOut: false, seconds: 2 }), 255);
});
(0, node_test_1.test)('exit codes: the process code passes through, a timeout is 124', () => {
    assert.equal((0, result_1.exitCodeOf)({ code: 3, timedOut: false, seconds: 1 }), 3);
    assert.equal((0, result_1.exitCodeOf)({ code: 1, timedOut: true, seconds: 1 }), 124);
});
//# sourceMappingURL=result.test.js.map