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
const clangdConfigText_1 = require("./clangdConfigText");
(0, node_test_1.test)('updateClangdContent creates a fresh file when none exists', () => {
    assert.equal((0, clangdConfigText_1.updateClangdContent)(undefined, 'C:\\proj\\build\\clang-debug'), 'CompileFlags:\n  CompilationDatabase: C:/proj/build/clang-debug\n');
});
(0, node_test_1.test)('updateClangdContent treats a whitespace-only file as empty', () => {
    assert.equal((0, clangdConfigText_1.updateClangdContent)('   \n\n', 'C:\\proj\\build'), 'CompileFlags:\n  CompilationDatabase: C:/proj/build\n');
});
(0, node_test_1.test)('updateClangdContent appends a CompileFlags block if the file has other content', () => {
    const existing = 'Diagnostics:\n  UnusedIncludes: Strict\n';
    const result = (0, clangdConfigText_1.updateClangdContent)(existing, 'C:\\proj\\build');
    assert.equal(result, 'Diagnostics:\n  UnusedIncludes: Strict\nCompileFlags:\n  CompilationDatabase: C:/proj/build\n');
});
(0, node_test_1.test)('updateClangdContent inserts CompilationDatabase into an existing CompileFlags block', () => {
    const existing = 'CompileFlags:\n  Add: [-Wall]\nDiagnostics:\n  UnusedIncludes: Strict\n';
    const result = (0, clangdConfigText_1.updateClangdContent)(existing, 'C:\\proj\\build\\ninja-debug');
    assert.equal(result, 'CompileFlags:\n  Add: [-Wall]\n  CompilationDatabase: C:/proj/build/ninja-debug\nDiagnostics:\n  UnusedIncludes: Strict\n');
});
(0, node_test_1.test)('updateClangdContent replaces an existing CompilationDatabase value in place', () => {
    const existing = 'CompileFlags:\n  CompilationDatabase: C:/proj/build/old\n  Add: [-Wall]\n';
    const result = (0, clangdConfigText_1.updateClangdContent)(existing, 'C:\\proj\\build\\new');
    assert.equal(result, 'CompileFlags:\n  CompilationDatabase: C:/proj/build/new\n  Add: [-Wall]\n');
});
//# sourceMappingURL=clangdConfigText.test.js.map