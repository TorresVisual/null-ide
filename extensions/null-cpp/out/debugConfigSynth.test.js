"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const debugConfigSynth_1 = require("./debugConfigSynth");
(0, node_test_1.default)('synthDebugConfig builds a cppvsdbg config for MSVC', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\msvc-debug\\Debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'msvc',
    });
    strict_1.default.deepEqual(config, {
        type: 'cppvsdbg',
        name: 'Debug app',
        request: 'launch',
        program: 'D:\\proj\\build\\msvc-debug\\Debug\\app.exe',
        args: [],
        cwd: 'D:\\proj',
    });
});
(0, node_test_1.default)('synthDebugConfig builds a cppdbg/lldb config for native Clang', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'clang',
        nativeMIMode: 'lldb',
    });
    strict_1.default.equal(config.type, 'cppdbg');
    strict_1.default.equal(config.MIMode, 'lldb');
    strict_1.default.equal(config.pipeTransport, undefined);
});
(0, node_test_1.default)('synthDebugConfig defaults native MIMode to gdb when nothing was resolved', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'clang',
    });
    strict_1.default.equal(config.MIMode, 'gdb');
});
(0, node_test_1.default)('synthDebugConfig builds a cppdbg/gdb pipeTransport config for WSL, translating paths to POSIX', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\wsl-debug\\app',
        sourceDir: 'D:\\proj',
        toolchainKind: 'wsl-gcc',
        wslDistro: 'Ubuntu',
    });
    strict_1.default.deepEqual(config, {
        type: 'cppdbg',
        name: 'Debug app',
        request: 'launch',
        program: '/mnt/d/proj/build/wsl-debug/app',
        args: [],
        cwd: '/mnt/d/proj',
        MIMode: 'gdb',
        pipeTransport: {
            pipeProgram: 'wsl.exe',
            pipeArgs: ['-d', 'Ubuntu'],
            debuggerPath: '/usr/bin/gdb',
        },
    });
});
(0, node_test_1.default)('synthDebugConfig throws for a WSL toolchain with no distro', () => {
    strict_1.default.throws(() => (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\wsl-debug\\app',
        sourceDir: 'D:\\proj',
        toolchainKind: 'wsl-clang',
    }));
});
//# sourceMappingURL=debugConfigSynth.test.js.map