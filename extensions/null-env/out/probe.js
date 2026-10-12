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
exports.executableNames = executableNames;
exports.extraToolDirs = extraToolDirs;
exports.findExecutable = findExecutable;
exports.findExecutableOnPath = findExecutableOnPath;
exports.findBundledBinary = findBundledBinary;
exports.findClangFormatPath = findClangFormatPath;
exports.findRustfmtPath = findRustfmtPath;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    }
    catch {
        return false;
    }
}
function pathDirs() {
    return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}
/** File names to try for `name`: on Windows the PATHEXT variants (`claude.cmd`, `cmake.exe`), unless it already has an extension. */
function executableNames(name, isWindows = process.platform === 'win32', pathext = process.env.PATHEXT) {
    if (!isWindows || path.extname(name)) {
        return [name];
    }
    return (pathext || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map(ext => name + ext.toLowerCase());
}
/** Directories tools commonly live in without being on the extension host's PATH. */
function extraToolDirs() {
    const home = os.homedir();
    const dirs = [path.join(home, '.cargo', 'bin')];
    if (process.platform === 'win32') {
        dirs.push('C:\Program Files\LLVM\bin', 'C:\Program Files (x86)\LLVM\bin', 'C:\LLVM\bin', path.join(home, 'scoop', 'apps', 'llvm', 'current', 'bin'), path.join(home, 'AppData', 'Local', 'Programs', 'LLVM', 'bin'));
    }
    return dirs;
}
/** First match for `name` in `dirs` (default: PATH, then the well-known extra dirs). PATH is read at call time but fixed at host launch. */
function findExecutable(name, dirs = [...pathDirs(), ...extraToolDirs()]) {
    const names = executableNames(name);
    for (const dir of dirs) {
        for (const n of names) {
            const full = path.join(dir, n);
            if (isFile(full)) {
                return full;
            }
        }
    }
    return null;
}
function findExecutableOnPath(name) {
    return findExecutable(name, pathDirs());
}
function findBundledBinary(extensionPath, binaryName) {
    const nameWithExt = process.platform === 'win32' && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName;
    const candidate = path.join(extensionPath, 'bin', nameWithExt);
    return isFile(candidate) ? candidate : null;
}
function findConfiguredOrBundled(name, configuredPath, extensionPath) {
    // 1. Explicit user-configured path
    if (configuredPath && configuredPath.trim().length > 0 && fs.existsSync(configuredPath)) {
        return configuredPath;
    }
    // 2. Bundled binary inside the owning extension's directory
    if (extensionPath) {
        const bundled = findBundledBinary(extensionPath, name);
        if (bundled) {
            return bundled;
        }
    }
    // 3. PATH plus the well-known install dirs (cargo bin, LLVM)
    return findExecutable(name);
}
function findClangFormatPath(configuredPath, extensionPath) {
    return findConfiguredOrBundled('clang-format', configuredPath, extensionPath);
}
function findRustfmtPath(configuredPath, extensionPath) {
    return findConfiguredOrBundled('rustfmt', configuredPath, extensionPath);
}
//# sourceMappingURL=probe.js.map