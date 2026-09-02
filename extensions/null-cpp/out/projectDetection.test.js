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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const projectDetectionScan_1 = require("./projectDetectionScan");
function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'null-cpp-detect-'));
}
function write(dir, relPath, contents = '') {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
}
(0, node_test_1.test)('empty workspace is not a C++ project', () => {
    const dir = tmpDir();
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('CMakeLists.txt is detected', () => {
    const dir = tmpDir();
    write(dir, 'CMakeLists.txt', 'project(x)');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('compile_commands.json is detected', () => {
    const dir = tmpDir();
    write(dir, 'compile_commands.json', '[]');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('.clangd is detected', () => {
    const dir = tmpDir();
    write(dir, '.clangd', 'CompileFlags:');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('.vcxproj is detected', () => {
    const dir = tmpDir();
    write(dir, 'App.vcxproj', '<Project />');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('meson.build is detected', () => {
    const dir = tmpDir();
    write(dir, 'meson.build', "project('x')");
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a Bazel WORKSPACE file is detected', () => {
    const dir = tmpDir();
    write(dir, 'WORKSPACE', '');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a Bazel BUILD.bazel file is detected', () => {
    const dir = tmpDir();
    write(dir, 'BUILD.bazel', '');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a Makefile is detected', () => {
    const dir = tmpDir();
    write(dir, 'Makefile', 'all:\n\techo hi');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a plain .cpp file is detected', () => {
    const dir = tmpDir();
    write(dir, 'src/hello.cpp', 'int main() {}');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a lone .cpp file directly in the root is detected', () => {
    const dir = tmpDir();
    write(dir, 'hello.cpp', 'int main() {}');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a vendored header under third_party is not evidence on its own', () => {
    const dir = tmpDir();
    write(dir, 'third_party/library/foo.hpp', '#pragma once');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a vendored header under node_modules is not evidence on its own', () => {
    const dir = tmpDir();
    write(dir, 'node_modules/some-pkg/native/binding.cpp', '');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a generated .cpp inside a build directory is not evidence', () => {
    const dir = tmpDir();
    write(dir, 'build/CMakeFiles/generated.cpp', '');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a compile_commands.json generated inside a build directory still counts', () => {
    const dir = tmpDir();
    write(dir, 'build/compile_commands.json', '[]');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('an unrelated project (only package.json) is not detected', () => {
    const dir = tmpDir();
    write(dir, 'package.json', '{}');
    write(dir, 'src/index.ts', '');
    assert.equal((0, projectDetectionScan_1.scanDirectoryForCppProject)(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
//# sourceMappingURL=projectDetection.test.js.map