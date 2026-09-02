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
exports.parseBuildDiagnosticLine = parseBuildDiagnosticLine;
exports.parseBuildOutput = parseBuildOutput;
exports.resolveDiagnosticPath = resolveDiagnosticPath;
exports.resolveBuildDiagnostics = resolveBuildDiagnostics;
const path = __importStar(require("node:path"));
const wslPath_1 = require("./wslPath");
// MSVC: `path(line,col): error C2065: message` (column is optional)
const MSVC_RE = /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)\s+([A-Za-z]+\d+)\s*:\s*(.*)$/;
// Clang/GCC: `path:line:col: error: message`
const GCC_CLANG_RE = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.*)$/;
function severityOf(raw) {
    return raw === 'warning' ? 'warning' : 'error';
}
/** Parses a single line of `cmake --build` output for an MSVC or Clang/GCC diagnostic. */
function parseBuildDiagnosticLine(line) {
    const msvc = MSVC_RE.exec(line);
    if (msvc) {
        return {
            file: msvc[1],
            line: Number(msvc[2]),
            column: msvc[3] ? Number(msvc[3]) : 1,
            severity: severityOf(msvc[4]),
            message: `${msvc[5]}: ${msvc[6]}`,
        };
    }
    const gccClang = GCC_CLANG_RE.exec(line);
    if (gccClang) {
        return {
            file: gccClang[1],
            line: Number(gccClang[2]),
            column: Number(gccClang[3]),
            severity: severityOf(gccClang[4]),
            message: gccClang[5],
        };
    }
    return undefined;
}
function parseBuildOutput(output) {
    const diagnostics = [];
    for (const line of output.split(/\r?\n/)) {
        const diagnostic = parseBuildDiagnosticLine(line);
        if (diagnostic) {
            diagnostics.push(diagnostic);
        }
    }
    return diagnostics;
}
/**
 * Resolves a diagnostic's file to a real Windows filesystem path. WSL builds emit either
 * `/mnt/<drive>/...` (translatable) or paths relative to the build cwd (same physical
 * location on both sides, since the workspace lives on a mounted Windows drive).
 */
function resolveDiagnosticPath(file, sourceDir, isWsl, wslDistro) {
    if (isWsl && wslDistro && file.startsWith('/')) {
        return (0, wslPath_1.fromWslPath)(file, wslDistro);
    }
    const normalized = isWsl ? file.replace(/\//g, '\\') : file;
    return path.isAbsolute(normalized) ? normalized : path.resolve(sourceDir, normalized);
}
function resolveBuildDiagnostics(output, sourceDir, isWsl, wslDistro) {
    return parseBuildOutput(output).map((d) => ({
        ...d,
        absolutePath: resolveDiagnosticPath(d.file, sourceDir, isWsl, wslDistro),
    }));
}
//# sourceMappingURL=buildDiagnostics.js.map