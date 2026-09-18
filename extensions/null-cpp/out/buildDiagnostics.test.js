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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("node:path"));
const buildDiagnostics_1 = require("./buildDiagnostics");
(0, node_test_1.default)('parseBuildDiagnosticLine parses an MSVC error with line and column', () => {
    const d = (0, buildDiagnostics_1.parseBuildDiagnosticLine)('D:\\proj\\src\\main.cpp(10,5): error C2065: \'x\': undeclared identifier');
    strict_1.default.deepEqual(d, {
        file: 'D:\\proj\\src\\main.cpp',
        line: 10,
        column: 5,
        severity: 'error',
        message: "C2065: 'x': undeclared identifier",
    });
});
(0, node_test_1.default)('parseBuildDiagnosticLine parses an MSVC warning with no column', () => {
    const d = (0, buildDiagnostics_1.parseBuildDiagnosticLine)('D:\\proj\\src\\main.cpp(20): warning C4101: \'y\': unreferenced local variable');
    strict_1.default.deepEqual(d, {
        file: 'D:\\proj\\src\\main.cpp',
        line: 20,
        column: 1,
        severity: 'warning',
        message: "C4101: 'y': unreferenced local variable",
    });
});
(0, node_test_1.default)('parseBuildDiagnosticLine parses a clang-cl error (MSVC-style position, no error code)', () => {
    const d = (0, buildDiagnostics_1.parseBuildDiagnosticLine)("D:\\proj\\src\\main.cpp(7,8): error: no member named 'println' in namespace 'std'");
    strict_1.default.deepEqual(d, {
        file: 'D:\\proj\\src\\main.cpp',
        line: 7,
        column: 8,
        severity: 'error',
        message: "no member named 'println' in namespace 'std'",
    });
});
(0, node_test_1.default)('parseBuildDiagnosticLine parses a Clang/GCC error', () => {
    const d = (0, buildDiagnostics_1.parseBuildDiagnosticLine)("/mnt/d/proj/src/main.cpp:10:5: error: use of undeclared identifier 'x'");
    strict_1.default.deepEqual(d, {
        file: '/mnt/d/proj/src/main.cpp',
        line: 10,
        column: 5,
        severity: 'error',
        message: "use of undeclared identifier 'x'",
    });
});
(0, node_test_1.default)('parseBuildDiagnosticLine returns undefined for a non-diagnostic line', () => {
    strict_1.default.equal((0, buildDiagnostics_1.parseBuildDiagnosticLine)('Building CXX object CMakeFiles/app.dir/main.cpp.o'), undefined);
});
(0, node_test_1.default)('parseBuildOutput extracts only the diagnostic lines from mixed build output', () => {
    const output = [
        'Building CXX object CMakeFiles/app.dir/main.cpp.o',
        'D:\\proj\\src\\main.cpp(10,5): error C2065: \'x\': undeclared identifier',
        'ninja: build stopped: subcommand failed.',
    ].join('\r\n');
    const diagnostics = (0, buildDiagnostics_1.parseBuildOutput)(output);
    strict_1.default.equal(diagnostics.length, 1);
    strict_1.default.equal(diagnostics[0].message, "C2065: 'x': undeclared identifier");
});
(0, node_test_1.default)('resolveDiagnosticPath leaves an absolute native Windows path as-is', () => {
    strict_1.default.equal((0, buildDiagnostics_1.resolveDiagnosticPath)('D:\\proj\\src\\main.cpp', 'D:\\proj', false, undefined), 'D:\\proj\\src\\main.cpp');
});
(0, node_test_1.default)('resolveDiagnosticPath resolves a relative native path against sourceDir', () => {
    strict_1.default.equal((0, buildDiagnostics_1.resolveDiagnosticPath)('src\\main.cpp', 'D:\\proj', false, undefined), path.resolve('D:\\proj', 'src\\main.cpp'));
});
(0, node_test_1.default)('resolveDiagnosticPath translates a WSL /mnt path back to a Windows drive path', () => {
    strict_1.default.equal((0, buildDiagnostics_1.resolveDiagnosticPath)('/mnt/d/proj/src/main.cpp', 'D:\\proj', true, 'Ubuntu'), 'D:\\proj\\src\\main.cpp');
});
(0, node_test_1.default)('resolveDiagnosticPath resolves a relative WSL path against sourceDir', () => {
    strict_1.default.equal((0, buildDiagnostics_1.resolveDiagnosticPath)('src/main.cpp', 'D:\\proj', true, 'Ubuntu'), path.resolve('D:\\proj', 'src\\main.cpp'));
});
(0, node_test_1.default)('resolveBuildDiagnostics attaches an absolutePath to every parsed diagnostic', () => {
    const output = '/mnt/d/proj/src/main.cpp:10:5: error: use of undeclared identifier \'x\'';
    const diagnostics = (0, buildDiagnostics_1.resolveBuildDiagnostics)(output, 'D:\\proj', true, 'Ubuntu');
    strict_1.default.equal(diagnostics.length, 1);
    strict_1.default.equal(diagnostics[0].absolutePath, 'D:\\proj\\src\\main.cpp');
});
//# sourceMappingURL=buildDiagnostics.test.js.map