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
const presetsModel_1 = require("./presetsModel");
const msvc = {
    id: 'msvc-14.38.33130-x64',
    kind: 'msvc',
    displayName: 'MSVC 14.38.33130 (x64)',
    compilerPath: 'C:\\VS\\VC\\Tools\\MSVC\\14.38.33130\\bin\\Hostx64\\x64\\cl.exe',
    arch: 'x64',
    detectedAt: 0,
};
const clang = {
    id: 'llvm-clang-cl-17.0.3',
    kind: 'clang',
    displayName: 'Clang-cl 17.0.3',
    compilerPath: 'C:\\Program Files\\LLVM\\bin\\clang-cl.exe',
    arch: 'x64',
    detectedAt: 0,
};
(0, node_test_1.test)('parseConfigurePresets returns [] for missing/malformed input', () => {
    assert.deepEqual((0, presetsModel_1.parseConfigurePresets)(undefined), []);
    assert.deepEqual((0, presetsModel_1.parseConfigurePresets)({}), []);
    assert.deepEqual((0, presetsModel_1.parseConfigurePresets)({ configurePresets: 'nope' }), []);
});
(0, node_test_1.test)('resolveAllPresets merges a single inherits chain', () => {
    const raws = [
        { name: 'base', generator: 'Ninja', cacheVariables: { CMAKE_BUILD_TYPE: 'Debug' } },
        { name: 'child', inherits: 'base', binaryDir: 'build/child' },
    ];
    const [, child] = (0, presetsModel_1.resolveAllPresets)(raws);
    assert.equal(child.generator, 'Ninja');
    assert.equal(child.binaryDir, 'build/child');
    assert.equal(child.cacheVariables?.CMAKE_BUILD_TYPE, 'Debug');
});
(0, node_test_1.test)('resolveAllPresets gives the first entry of a multi-parent inherits list priority', () => {
    const raws = [
        { name: 'a', cacheVariables: { X: '1' } },
        { name: 'b', cacheVariables: { X: '2' } },
        { name: 'child', inherits: ['a', 'b'] },
    ];
    const [, , child] = (0, presetsModel_1.resolveAllPresets)(raws);
    assert.equal(child.cacheVariables?.X, '1');
});
(0, node_test_1.test)('resolveAllPresets lets the preset itself override every parent', () => {
    const raws = [
        { name: 'base', cacheVariables: { X: '1' } },
        { name: 'child', inherits: 'base', cacheVariables: { X: '2' } },
    ];
    const [, child] = (0, presetsModel_1.resolveAllPresets)(raws);
    assert.equal(child.cacheVariables?.X, '2');
});
(0, node_test_1.test)('resolveAllPresets throws on a circular inherits chain', () => {
    const raws = [
        { name: 'a', inherits: 'b' },
        { name: 'b', inherits: 'a' },
    ];
    assert.throws(() => (0, presetsModel_1.resolveAllPresets)(raws), /circular/i);
});
(0, node_test_1.test)('expandMacros substitutes sourceDir and presetName', () => {
    const result = (0, presetsModel_1.expandMacros)('${sourceDir}/build/${presetName}', {
        sourceDir: 'C:\\proj',
        presetName: 'clang-debug',
    });
    assert.equal(result, 'C:\\proj/build/clang-debug');
});
(0, node_test_1.test)('resolveToolchainId matches by compiler executable basename', () => {
    const raw = { name: 'p', cacheVariables: { CMAKE_CXX_COMPILER: 'clang-cl.exe' } };
    assert.equal((0, presetsModel_1.resolveToolchainId)(raw, [msvc, clang]), clang.id);
});
(0, node_test_1.test)('resolveToolchainId returns "" when nothing matches', () => {
    const raw = { name: 'p', cacheVariables: { CMAKE_CXX_COMPILER: 'gcc' } };
    assert.equal((0, presetsModel_1.resolveToolchainId)(raw, [msvc, clang]), '');
});
(0, node_test_1.test)('resolveToolchainId handles {type,value} cache variable objects', () => {
    const raw = {
        name: 'p',
        cacheVariables: { CMAKE_CXX_COMPILER: { type: 'FILEPATH', value: 'clang-cl.exe' } },
    };
    assert.equal((0, presetsModel_1.resolveToolchainId)(raw, [msvc, clang]), clang.id);
});
(0, node_test_1.test)('inferIsWsl respects an explicit vendor opt-in over any heuristic', () => {
    const raw = { name: 'p', generator: 'Visual Studio 17 2022', vendor: { 'null-cpp': { wsl: true } } };
    assert.equal((0, presetsModel_1.inferIsWsl)(raw), true);
});
(0, node_test_1.test)('inferIsWsl infers true for a Ninja/Unix Makefiles preset with a POSIX compiler path', () => {
    const raw = {
        name: 'p',
        generator: 'Ninja',
        cacheVariables: { CMAKE_CXX_COMPILER: '/usr/bin/g++' },
    };
    assert.equal((0, presetsModel_1.inferIsWsl)(raw), true);
});
(0, node_test_1.test)('inferIsWsl is false for a Ninja preset pointed at a native Windows compiler', () => {
    const raw = {
        name: 'p',
        generator: 'Ninja',
        cacheVariables: { CMAKE_CXX_COMPILER: 'C:\\LLVM\\bin\\clang-cl.exe' },
    };
    assert.equal((0, presetsModel_1.inferIsWsl)(raw), false);
});
(0, node_test_1.test)('inferIsWsl is false for a Visual Studio generator regardless of compiler path', () => {
    const raw = { name: 'p', generator: 'Visual Studio 17 2022' };
    assert.equal((0, presetsModel_1.inferIsWsl)(raw), false);
});
(0, node_test_1.test)('toCMakePreset falls back to name for displayName and a default binaryDir', () => {
    const preset = (0, presetsModel_1.toCMakePreset)({ name: 'clang-debug', generator: 'Ninja' }, 'C:\\proj', []);
    assert.equal(preset.displayName, 'clang-debug');
    assert.equal(preset.binaryDir, 'C:\\proj/build/clang-debug');
});
(0, node_test_1.test)('loadPresets merges main + user presets and drops hidden ones', () => {
    const main = {
        configurePresets: [
            { name: 'base', hidden: true, generator: 'Ninja' },
            { name: 'clang-debug', inherits: 'base', displayName: 'Clang Debug', cacheVariables: { CMAKE_CXX_COMPILER: 'clang-cl.exe' } },
        ],
    };
    const user = {
        configurePresets: [{ name: 'msvc-debug', generator: 'Visual Studio 17 2022', cacheVariables: { CMAKE_CXX_COMPILER: 'cl.exe' } }],
    };
    const presets = (0, presetsModel_1.loadPresets)(main, user, 'C:\\proj', [msvc, clang]);
    assert.equal(presets.length, 2);
    const clangPreset = presets.find((p) => p.name === 'clang-debug');
    assert.equal(clangPreset?.toolchainId, clang.id);
    assert.equal(clangPreset?.displayName, 'Clang Debug');
    const msvcPreset = presets.find((p) => p.name === 'msvc-debug');
    assert.equal(msvcPreset?.toolchainId, msvc.id);
});
(0, node_test_1.test)('resolveToolchainId matches a CXX "g++" preset against a detected "gcc" toolchain', () => {
    const wslGcc = {
        id: 'wsl-Ubuntu-gcc',
        kind: 'wsl-gcc',
        displayName: 'WSL: Ubuntu (gcc)',
        compilerPath: '/usr/bin/gcc',
        arch: 'x64',
        wslDistro: 'Ubuntu',
        detectedAt: 0,
    };
    const raw = {
        name: 'wsl-debug',
        generator: 'Unix Makefiles',
        cacheVariables: { CMAKE_C_COMPILER: '/usr/bin/gcc', CMAKE_CXX_COMPILER: '/usr/bin/g++' },
    };
    assert.equal((0, presetsModel_1.resolveToolchainId)(raw, [wslGcc]), wslGcc.id);
});
(0, node_test_1.test)('resolveToolchainId matches a CXX "clang++" preset against a detected "clang" toolchain', () => {
    const wslClang = {
        id: 'wsl-Ubuntu-clang',
        kind: 'wsl-clang',
        displayName: 'WSL: Ubuntu (clang)',
        compilerPath: '/usr/bin/clang',
        arch: 'x64',
        wslDistro: 'Ubuntu',
        detectedAt: 0,
    };
    const raw = {
        name: 'wsl-clang-debug',
        generator: 'Unix Makefiles',
        cacheVariables: { CMAKE_CXX_COMPILER: '/usr/bin/clang++' },
    };
    assert.equal((0, presetsModel_1.resolveToolchainId)(raw, [wslClang]), wslClang.id);
});
//# sourceMappingURL=presetsModel.test.js.map