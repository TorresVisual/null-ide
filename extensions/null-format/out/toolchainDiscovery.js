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
exports.findExecutableOnPath = findExecutableOnPath;
exports.findBundledBinary = findBundledBinary;
exports.findClangFormatPath = findClangFormatPath;
exports.findRustfmtPath = findRustfmtPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function findExecutableOnPath(executableName) {
    const isWindows = process.platform === 'win32';
    const nameWithExt = isWindows && !executableName.endsWith('.exe')
        ? `${executableName}.exe`
        : executableName;
    const pathEnv = process.env.PATH || '';
    const pathSeparator = isWindows ? ';' : ':';
    const directories = pathEnv.split(pathSeparator);
    for (const dir of directories) {
        if (!dir)
            continue;
        const fullPath = path.join(dir, nameWithExt);
        try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                return fullPath;
            }
        }
        catch {
            // Ignore permission or stat errors
        }
    }
    return null;
}
function findBundledBinary(extensionPath, binaryName) {
    const isWindows = process.platform === 'win32';
    const nameWithExt = isWindows && !binaryName.endsWith('.exe')
        ? `${binaryName}.exe`
        : binaryName;
    const candidate = path.join(extensionPath, 'bin', nameWithExt);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
    }
    return null;
}
function findClangFormatPath(configuredPath, extensionPath) {
    // 1. Explicit user-configured path
    if (configuredPath && configuredPath.trim().length > 0) {
        if (fs.existsSync(configuredPath)) {
            return configuredPath;
        }
    }
    // 2. Bundled binary inside extension directory
    if (extensionPath) {
        const bundled = findBundledBinary(extensionPath, 'clang-format');
        if (bundled) {
            return bundled;
        }
    }
    // 3. Known LLVM / Visual Studio locations on Windows
    if (process.platform === 'win32') {
        const standardLocations = [
            'C:\\Program Files\\LLVM\\bin\\clang-format.exe',
            'C:\\Program Files (x86)\\LLVM\\bin\\clang-format.exe',
            'C:\\LLVM\\bin\\clang-format.exe',
            path.join(os.homedir(), 'scoop', 'apps', 'llvm', 'current', 'bin', 'clang-format.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'LLVM', 'bin', 'clang-format.exe'),
        ];
        for (const loc of standardLocations) {
            if (fs.existsSync(loc)) {
                return loc;
            }
        }
    }
    // 4. PATH lookup
    return findExecutableOnPath('clang-format');
}
function findRustfmtPath(configuredPath, extensionPath) {
    // 1. Explicit user-configured path
    if (configuredPath && configuredPath.trim().length > 0) {
        if (fs.existsSync(configuredPath)) {
            return configuredPath;
        }
    }
    // 2. Bundled binary inside extension directory
    if (extensionPath) {
        const bundled = findBundledBinary(extensionPath, 'rustfmt');
        if (bundled) {
            return bundled;
        }
    }
    // 3. Known Cargo / rustup locations
    const cargoBin = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'rustfmt.exe' : 'rustfmt');
    if (fs.existsSync(cargoBin)) {
        return cargoBin;
    }
    // 4. PATH lookup
    return findExecutableOnPath('rustfmt');
}
//# sourceMappingURL=toolchainDiscovery.js.map