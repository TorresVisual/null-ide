"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const singleFileCompileArgs_1 = require("./singleFileCompileArgs");
(0, node_test_1.default)('isHeaderFile correctly identifies header extensions', () => {
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.h'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.hpp'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.hxx'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.hh'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.inl'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.HPP'), true);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.cpp'), false);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.cc'), false);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.cxx'), false);
    strict_1.default.equal((0, singleFileCompileArgs_1.isHeaderFile)('test.c'), false);
});
(0, node_test_1.default)('resolveOutputBinaryPath resolves native Windows .exe target', () => {
    const binary = (0, singleFileCompileArgs_1.resolveOutputBinaryPath)('D:\\proj\\tests\\test_runner.cpp', false);
    strict_1.default.equal(binary, 'D:\\proj\\tests\\test_runner.exe');
});
(0, node_test_1.default)('resolveOutputBinaryPath resolves WSL target without .exe', () => {
    const binary = (0, singleFileCompileArgs_1.resolveOutputBinaryPath)('D:\\proj\\tests\\test_runner.cpp', true);
    strict_1.default.equal(binary, 'D:\\proj\\tests\\test_runner');
});
(0, node_test_1.default)('resolveOutputBinaryPath respects custom output directory', () => {
    const binary = (0, singleFileCompileArgs_1.resolveOutputBinaryPath)('D:\\proj\\tests\\test_runner.cpp', false, 'D:\\proj\\bin');
    strict_1.default.equal(binary, 'D:\\proj\\bin\\test_runner.exe');
});
(0, node_test_1.default)('buildCompileArgs constructs default args for a standalone .cpp file', () => {
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath: 'D:\\proj\\tests\\test_runner.cpp',
        sourceDir: 'D:\\proj',
        outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
        isWsl: false,
    });
    strict_1.default.deepEqual(args, [
        '-std=c++20',
        '-Wall',
        '-Wextra',
        '-o',
        'D:\\proj\\tests\\test_runner.exe',
        '-ID:\\proj\\tests',
        '-ID:\\proj',
        'D:\\proj\\tests\\test_runner.cpp',
    ]);
});
(0, node_test_1.default)('buildCompileArgs enables -fsyntax-only and omits -o for header files', () => {
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath: 'D:\\proj\\include\\header.hpp',
        sourceDir: 'D:\\proj',
        outputBinaryPath: 'D:\\proj\\include\\header.exe',
        isWsl: false,
    });
    strict_1.default.deepEqual(args, [
        '-std=c++20',
        '-Wall',
        '-Wextra',
        '-fsyntax-only',
        '-ID:\\proj\\include',
        '-ID:\\proj',
        'D:\\proj\\include\\header.hpp',
    ]);
});
(0, node_test_1.default)('buildCompileArgs respects custom extraArgs', () => {
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath: 'D:\\proj\\tests\\test_runner.cpp',
        sourceDir: 'D:\\proj',
        extraArgs: ['-std=c++17', '-O2'],
        outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
        isWsl: false,
    });
    strict_1.default.deepEqual(args, [
        '-std=c++17',
        '-O2',
        '-o',
        'D:\\proj\\tests\\test_runner.exe',
        '-ID:\\proj\\tests',
        '-ID:\\proj',
        'D:\\proj\\tests\\test_runner.cpp',
    ]);
});
(0, node_test_1.default)('buildCompileArgs adds extra include directories', () => {
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath: 'D:\\proj\\tests\\test_runner.cpp',
        sourceDir: 'D:\\proj',
        includeDirs: ['D:\\proj\\include', 'D:\\proj\\src'],
        outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
        isWsl: false,
    });
    strict_1.default.deepEqual(args, [
        '-std=c++20',
        '-Wall',
        '-Wextra',
        '-o',
        'D:\\proj\\tests\\test_runner.exe',
        '-ID:\\proj\\tests',
        '-ID:\\proj',
        '-ID:\\proj\\include',
        '-ID:\\proj\\src',
        'D:\\proj\\tests\\test_runner.cpp',
    ]);
});
(0, node_test_1.default)('buildCompileArgs converts paths to POSIX for WSL', () => {
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath: 'D:\\proj\\tests\\test_runner.cpp',
        sourceDir: 'D:\\proj',
        includeDirs: ['D:\\proj\\include'],
        outputBinaryPath: 'D:\\proj\\tests\\test_runner',
        isWsl: true,
    });
    strict_1.default.deepEqual(args, [
        '-std=c++20',
        '-Wall',
        '-Wextra',
        '-o',
        '/mnt/d/proj/tests/test_runner',
        '-I/mnt/d/proj/tests',
        '-I/mnt/d/proj',
        '-I/mnt/d/proj/include',
        '/mnt/d/proj/tests/test_runner.cpp',
    ]);
});
//# sourceMappingURL=singleFileCompile.test.js.map