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
const cmakeScaffoldContent_1 = require("./cmakeScaffoldContent");
function toolchain(overrides) {
    return {
        id: 'msvc-17.9.34728-x64',
        kind: 'msvc',
        displayName: 'MSVC 17.9.34728 (x64)',
        compilerPath: 'C:\\VS\\cl.exe',
        arch: 'x64',
        detectedAt: 0,
        ...overrides,
    };
}
(0, node_test_1.test)('slugifyToolchainId lowercases and strips non-alphanumeric runs', () => {
    assert.equal((0, cmakeScaffoldContent_1.slugifyToolchainId)('msvc-17.9.34728-x64'), 'msvc-17-9-34728-x64');
    assert.equal((0, cmakeScaffoldContent_1.slugifyToolchainId)('wsl-Ubuntu-22.04-gcc'), 'wsl-ubuntu-22-04-gcc');
});
(0, node_test_1.test)('presetFor uses Ninja + the raw compiler path for native toolchains', () => {
    const preset = (0, cmakeScaffoldContent_1.presetFor)(toolchain({}));
    assert.equal(preset.generator, 'Ninja');
    assert.equal(preset.cacheVariables.CMAKE_CXX_COMPILER, 'C:\\VS\\cl.exe');
    assert.equal(preset.binaryDir, '${sourceDir}/build/msvc-17-9-34728-x64-debug');
});
(0, node_test_1.test)('presetFor turns on CMAKE_EXPORT_COMPILE_COMMANDS so clangd works even against hand-written CMakeLists.txt', () => {
    const preset = (0, cmakeScaffoldContent_1.presetFor)(toolchain({}));
    assert.equal(preset.cacheVariables.CMAKE_EXPORT_COMPILE_COMMANDS, 'ON');
});
(0, node_test_1.test)('presetFor uses Unix Makefiles for WSL toolchains', () => {
    const preset = (0, cmakeScaffoldContent_1.presetFor)(toolchain({ id: 'wsl-Ubuntu-gcc', kind: 'wsl-gcc', compilerPath: '/usr/bin/gcc', wslDistro: 'Ubuntu' }));
    assert.equal(preset.generator, 'Unix Makefiles');
});
(0, node_test_1.test)('presetsJsonContent emits one configurePreset per toolchain', () => {
    const json = JSON.parse((0, cmakeScaffoldContent_1.presetsJsonContent)([toolchain({}), toolchain({ id: 'llvm-clang-cl-19.1.0', kind: 'clang' })]));
    assert.equal(json.configurePresets.length, 2);
});
(0, node_test_1.test)('cmakeListsContent globs src/ into an executable named after the project', () => {
    const content = (0, cmakeScaffoldContent_1.cmakeListsContent)('MiniGit');
    assert.match(content, /project\(MiniGit CXX\)/);
    assert.match(content, /add_executable\(MiniGit \$\{MINIGIT_SOURCES\}\)/);
});
(0, node_test_1.test)('nestedCMakeListsContent emits a library target, not a standalone project', () => {
    const content = (0, cmakeScaffoldContent_1.nestedCMakeListsContent)('Engine');
    assert.doesNotMatch(content, /project\(/);
    assert.match(content, /add_library\(Engine STATIC \$\{ENGINE_SOURCES\}\)/);
});
(0, node_test_1.test)('appendAddSubdirectory adds the line once', () => {
    const once = (0, cmakeScaffoldContent_1.appendAddSubdirectory)('cmake_minimum_required(VERSION 3.20)\nproject(App CXX)\n', 'libs/engine');
    assert.match(once, /add_subdirectory\(libs\/engine\)/);
    const twice = (0, cmakeScaffoldContent_1.appendAddSubdirectory)(once, 'libs/engine');
    assert.equal(twice, once);
});
(0, node_test_1.test)('appendAddSubdirectory normalizes backslashes to forward slashes', () => {
    const content = (0, cmakeScaffoldContent_1.appendAddSubdirectory)('project(App CXX)\n', 'libs\\engine');
    assert.match(content, /add_subdirectory\(libs\/engine\)/);
});
//# sourceMappingURL=cmakeScaffold.test.js.map