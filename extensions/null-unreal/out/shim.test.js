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
const shim_1 = require("./shim");
const EXEC = 'C:\\Users\\Me\\AppData\\Local\\Programs\\Null IDE\\null.exe';
const CLI = 'C:\\Users\\Me\\AppData\\Local\\Programs\\Null IDE\\resources\\app\\extensions\\null-unreal\\out\\cli.js';
(0, node_test_1.test)('both shims quote the editor runtime and the CLI path, spaces included', () => {
    const f = (0, shim_1.shimFiles)(EXEC, CLI);
    assert.ok(f['null-unreal.cmd'].includes(`"${EXEC}" "${CLI}"`));
    assert.ok(f['null-unreal'].includes(`"${EXEC}" "${CLI}"`));
});
(0, node_test_1.test)('the .cmd sets ELECTRON_RUN_AS_NODE, forwards %* and uses CRLF', () => {
    const cmd = (0, shim_1.shimFiles)(EXEC, CLI)['null-unreal.cmd'];
    assert.match(cmd, /set ELECTRON_RUN_AS_NODE=1/);
    assert.ok(cmd.includes('%*'));
    assert.ok(cmd.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(cmd), 'every newline is CRLF');
});
(0, node_test_1.test)('the POSIX shim is a sh script that forwards "$@"', () => {
    const sh = (0, shim_1.shimFiles)(EXEC, CLI)['null-unreal'];
    assert.ok(sh.startsWith('#!/bin/sh\n'));
    assert.match(sh, /export ELECTRON_RUN_AS_NODE=1/);
    assert.match(sh, /exec "/);
    assert.ok(sh.includes('"$@"'));
});
(0, node_test_1.test)('the usage snippet names the absolute shim path and all five commands', () => {
    const shimPath = 'C:\\Users\\Me\\AppData\\Local\\Null\\bin\\null-unreal.cmd';
    const s = (0, shim_1.cliUsageSnippet)(shimPath);
    assert.ok(s.includes(shimPath));
    for (const c of ['build', 'test', 'run', 'smoke', 'export'])
        assert.ok(s.includes(c), `mentions ${c}`);
});
//# sourceMappingURL=shim.test.js.map