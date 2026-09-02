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
exports.scanDirectoryForCppProject = scanDirectoryForCppProject;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Definitive project/build config for a C/C++ project.
const STRONG_FILENAMES = new Set([
    'CMakeLists.txt',
    'compile_commands.json',
    '.clangd',
    'meson.build',
    'Makefile',
    'makefile',
    'GNUmakefile',
    'BUILD',
    'BUILD.bazel',
    'WORKSPACE',
    'WORKSPACE.bazel',
]);
const STRONG_EXTENSIONS = ['.vcxproj', '.vcxproj.filters'];
// A source/header file alone is weaker evidence: plenty of repos carry an
// incidental or vendored C/C++ file without being a C++ project.
const WEAK_EXTENSIONS = ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'];
// Dependency/vendor directories: never descended into, so nothing inside
// (strong or weak) ever counts as evidence.
const PRUNED_DIRS = new Set([
    'node_modules',
    '.git',
    'vendor',
    'vendors',
    'third_party',
    'third-party',
    'external',
    '.cache',
    'site-packages'
]);
// Build/output directories: still descended into (a generated
// compile_commands.json here is genuine evidence), but source/header files
// found here are generated or intermediate, not real evidence.
const WEAK_EXCLUDED_DIRS = new Set(['build', 'out', 'dist', 'target', 'bin', 'obj']);
// ponytail: naive cap on directories visited so a pathological/huge tree can't hang
// activation; bump this or switch to VS Code's indexed search if it proves too small.
const MAX_DIRS_SCANNED = 2000;
function isStrongEvidence(filename) {
    return STRONG_FILENAMES.has(filename) || STRONG_EXTENSIONS.some(ext => filename.endsWith(ext));
}
function isWeakEvidence(filename) {
    return WEAK_EXTENSIONS.some(ext => filename.endsWith(ext));
}
/** Recursively scans a directory for C/C++ project evidence. Pure Node fs, no vscode dependency. */
function scanDirectoryForCppProject(rootDir) {
    const stack = [{ dir: rootDir, weakExcluded: false }];
    let dirsScanned = 0;
    while (stack.length > 0) {
        if (dirsScanned++ >= MAX_DIRS_SCANNED) {
            break;
        }
        const { dir, weakExcluded } = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (PRUNED_DIRS.has(entry.name)) {
                    continue;
                }
                stack.push({
                    dir: path.join(dir, entry.name),
                    weakExcluded: weakExcluded || WEAK_EXCLUDED_DIRS.has(entry.name),
                });
            }
            else if (entry.isFile()) {
                if (isStrongEvidence(entry.name)) {
                    return true;
                }
                if (!weakExcluded && isWeakEvidence(entry.name)) {
                    return true;
                }
            }
        }
    }
    return false;
}
//# sourceMappingURL=projectDetectionScan.js.map