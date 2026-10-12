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
const detect_1 = require("./detect");
const list = (names) => () => names;
(0, node_test_1.test)('an empty folder has no projects and no languages', () => {
    assert.deepEqual((0, detect_1.detectProjects)('/x', list([])), []);
    assert.deepEqual((0, detect_1.detectLanguages)('/x', list([])), []);
});
(0, node_test_1.test)('each manifest maps to its language', () => {
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['Cargo.toml'])), [{ language: 'rust', manifest: 'Cargo.toml' }]);
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['CMakeLists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['compile_commands.json'])), [{ language: 'cpp', manifest: 'compile_commands.json' }]);
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['.clangd'])), [{ language: 'cpp', manifest: '.clangd' }]);
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['package.json'])), [{ language: 'node', manifest: 'package.json' }]);
});
(0, node_test_1.test)('a .csproj file of any name is a dotnet project, reported once', () => {
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['App.csproj', 'Lib.csproj'])), [{ language: 'dotnet', manifest: '.csproj' }]);
});
(0, node_test_1.test)('manifest names match case-insensitively', () => {
    assert.deepEqual((0, detect_1.detectProjects)('/x', list(['cmakelists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
});
(0, node_test_1.test)('results follow the table order: Cargo, CMake, then the rest', () => {
    const manifests = (0, detect_1.detectProjects)('/x', list(['CMakeLists.txt', 'Cargo.toml', 'package.json', 'A.csproj'])).map(p => p.manifest);
    assert.deepEqual(manifests, ['Cargo.toml', 'CMakeLists.txt', 'package.json', '.csproj']);
});
(0, node_test_1.test)('detectLanguages returns each language once', () => {
    const languages = (0, detect_1.detectLanguages)('/x', list(['CMakeLists.txt', 'compile_commands.json', '.clangd', 'Cargo.toml']));
    assert.deepEqual(languages, ['rust', 'cpp']);
});
(0, node_test_1.test)('an unreadable folder yields nothing instead of throwing', () => {
    const boom = () => { throw new Error('ENOENT'); };
    assert.deepEqual((0, detect_1.detectProjects)('/missing', boom), []);
    assert.deepEqual((0, detect_1.detectLanguages)('/missing', boom), []);
});
//# sourceMappingURL=detect.test.js.map