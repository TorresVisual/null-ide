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
        compilerPath: 'C:\\...\\cl.exe',
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
(0, node_test_1.default)('synthDebugConfig builds a cppvsdbg config for clang-cl (PDB debug info, same as MSVC)', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'clang',
        compilerPath: 'C:\\Program Files\\LLVM\\bin\\clang-cl.exe',
    });
    strict_1.default.equal(config.type, 'cppvsdbg');
});
(0, node_test_1.default)('synthDebugConfig builds a cppdbg/lldb config for plain native Clang, with an explicit miDebuggerPath', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'clang',
        compilerPath: 'C:\\Program Files\\LLVM\\bin\\clang.exe',
        nativeDebugger: { mode: 'lldb', path: 'C:\\LLVM\\bin\\lldb-mi.exe' },
    });
    strict_1.default.equal(config.type, 'cppdbg');
    strict_1.default.equal(config.MIMode, 'lldb');
    strict_1.default.equal(config.miDebuggerPath, 'C:\\LLVM\\bin\\lldb-mi.exe');
    strict_1.default.equal(config.pipeTransport, undefined);
});
(0, node_test_1.default)('synthDebugConfig throws for a native toolchain with no gdb/lldb resolved on PATH', () => {
    strict_1.default.throws(() => (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
        sourceDir: 'D:\\proj',
        toolchainKind: 'clang',
        compilerPath: 'C:\\Program Files\\LLVM\\bin\\clang.exe',
    }));
});
(0, node_test_1.default)('synthDebugConfig builds a cppdbg/gdb pipeTransport config for WSL, translating paths to POSIX', () => {
    const config = (0, debugConfigSynth_1.synthDebugConfig)({
        targetName: 'app',
        artifactPath: 'D:\\proj\\build\\wsl-debug\\app',
        sourceDir: 'D:\\proj',
        toolchainKind: 'wsl-gcc',
        compilerPath: '/usr/bin/gcc',
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
        compilerPath: '/usr/bin/clang',
    }));
});
(0, node_test_1.default)('usesPdbDebugInfo is true for msvc and clang-cl, false for plain clang/gcc', () => {
    strict_1.default.equal((0, debugConfigSynth_1.usesPdbDebugInfo)('msvc', 'C:\\...\\cl.exe'), true);
    strict_1.default.equal((0, debugConfigSynth_1.usesPdbDebugInfo)('clang', 'C:\\LLVM\\bin\\clang-cl.exe'), true);
    strict_1.default.equal((0, debugConfigSynth_1.usesPdbDebugInfo)('clang', 'C:\\LLVM\\bin\\clang.exe'), false);
    strict_1.default.equal((0, debugConfigSynth_1.usesPdbDebugInfo)('wsl-gcc', '/usr/bin/gcc'), false);
});
//# sourceMappingURL=debugConfigSynth.test.js.map