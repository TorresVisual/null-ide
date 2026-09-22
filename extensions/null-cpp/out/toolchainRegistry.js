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
exports.list = list;
exports.refresh = refresh;
exports.parseVswhereInstallPaths = parseVswhereInstallPaths;
exports.pickLatestMsvcVersion = pickLatestMsvcVersion;
exports.pathExists = pathExists;
exports.parseClangVersion = parseClangVersion;
exports.findOnPath = findOnPath;
exports.findClangxx = findClangxx;
exports.parseWslDistroList = parseWslDistroList;
exports.parseSetOutput = parseSetOutput;
exports.getMsvcDevEnvironment = getMsvcDevEnvironment;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
let cached = [];
function list() {
    return cached;
}
async function refresh() {
    const [msvc, clang, wsl] = await Promise.all([
        detectMsvc().catch(() => []),
        detectClang().catch(() => []),
        detectWsl().catch(() => []),
    ]);
    cached = [...msvc, ...clang, ...wsl];
    return cached;
}
// ---- MSVC ----
function parseVswhereInstallPaths(stdout) {
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
function pickLatestMsvcVersion(versions) {
    const parsed = versions
        .map((v) => ({ v, parts: v.split('.').map((n) => Number.parseInt(n, 10)) }))
        .filter((p) => p.parts.length > 0 && p.parts.every((n) => !Number.isNaN(n)));
    if (parsed.length === 0) {
        return undefined;
    }
    parsed.sort((a, b) => {
        const len = Math.max(a.parts.length, b.parts.length);
        for (let i = 0; i < len; i++) {
            const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
            if (diff !== 0) {
                return diff;
            }
        }
        return 0;
    });
    return parsed[parsed.length - 1].v;
}
function findVswherePath() {
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
}
async function pathExists(candidate) {
    try {
        await fs.access(candidate);
        return true;
    }
    catch {
        return false;
    }
}
async function detectMsvc() {
    const vswherePath = findVswherePath();
    if (!(await pathExists(vswherePath))) {
        return [];
    }
    const { stdout } = await execFileAsync(vswherePath, [
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
    ], { timeout: 3000 });
    const installPaths = parseVswhereInstallPaths(stdout);
    const toolchains = [];
    for (const installPath of installPaths) {
        const msvcToolsDir = path.join(installPath, 'VC', 'Tools', 'MSVC');
        let versions;
        try {
            versions = (await fs.readdir(msvcToolsDir, { withFileTypes: true }))
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);
        }
        catch {
            continue;
        }
        // The numerically newest MSVC toolset directory isn't always a complete install (e.g. a
        // partially-applied VS update can leave a newer version directory with no x64 host
        // compiler) - fall back through older versions until one actually has a working cl.exe.
        let remaining = versions;
        let latest;
        let compilerPath;
        while (remaining.length > 0) {
            const candidate = pickLatestMsvcVersion(remaining);
            if (!candidate) {
                break;
            }
            const candidatePath = path.join(msvcToolsDir, candidate, 'bin', 'Hostx64', 'x64', 'cl.exe');
            if (await pathExists(candidatePath)) {
                latest = candidate;
                compilerPath = candidatePath;
                break;
            }
            remaining = remaining.filter((v) => v !== candidate);
        }
        if (!latest || !compilerPath) {
            continue;
        }
        toolchains.push({
            id: `msvc-${latest}-x64`,
            kind: 'msvc',
            displayName: `MSVC ${latest} (x64)`,
            compilerPath,
            arch: 'x64',
            installPath,
            detectedAt: Date.now(),
        });
    }
    return toolchains;
}
// ---- Clang / clang-cl ----
function parseClangVersion(output) {
    return /clang version ([\d.]+)/i.exec(output)?.[1];
}
function pathDirs() {
    return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}
async function findOnPath(exeName) {
    for (const dir of pathDirs()) {
        const candidate = path.join(dir, exeName);
        if (await pathExists(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
async function detectClangAt(compilerPath, idPrefix, displayPrefix) {
    try {
        const { stdout } = await execFileAsync(compilerPath, ['--version'], { timeout: 3000 });
        const version = parseClangVersion(stdout);
        if (!version) {
            return undefined;
        }
        return {
            id: `${idPrefix}-${version}`,
            kind: 'clang',
            displayName: `${displayPrefix} ${version}`,
            compilerPath,
            arch: 'x64',
            detectedAt: Date.now(),
        };
    }
    catch {
        return undefined;
    }
}
async function detectClang() {
    const toolchains = [];
    const clangCl = await findOnPath('clang-cl.exe');
    if (clangCl) {
        const t = await detectClangAt(clangCl, 'llvm-clang-cl', 'Clang-cl');
        if (t) {
            toolchains.push(t);
        }
    }
    const clangxx = await findOnPath('clang++.exe');
    if (clangxx) {
        const t = await detectClangAt(clangxx, 'llvm-clangxx', 'Clang++');
        if (t) {
            toolchains.push(t);
        }
    }
    const clang = await findOnPath('clang.exe');
    if (clang) {
        const t = await detectClangAt(clang, 'llvm-clang', 'Clang');
        if (t) {
            toolchains.push(t);
        }
    }
    return toolchains;
}
async function findClangxx() {
    const clangxx = (await findOnPath('clang++.exe')) ?? (await findOnPath('clang++'));
    if (clangxx) {
        return { compilerPath: clangxx, isWsl: false };
    }
    const clang = await findOnPath('clang.exe');
    if (clang) {
        const siblingClangxx = path.join(path.dirname(clang), 'clang++.exe');
        if (await pathExists(siblingClangxx)) {
            return { compilerPath: siblingClangxx, isWsl: false };
        }
    }
    const clangCl = await findOnPath('clang-cl.exe');
    if (clangCl) {
        const siblingClangxx = path.join(path.dirname(clangCl), 'clang++.exe');
        if (await pathExists(siblingClangxx)) {
            return { compilerPath: siblingClangxx, isWsl: false };
        }
    }
    return undefined;
}
// ---- WSL ----
function parseWslDistroList(raw) {
    return raw
        .replace(/\u0000/g, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^windows subsystem for linux distributions/i.test(line));
}
async function wslWhich(distro, tool) {
    try {
        const { stdout } = await execFileAsync('wsl.exe', ['-d', distro, '--', 'which', tool], {
            encoding: 'utf8',
            timeout: 3000,
        });
        const cleaned = stdout.replace(/\u0000/g, '').trim();
        return cleaned.length > 0 ? cleaned : undefined;
    }
    catch {
        return undefined;
    }
}
async function detectWslDistro(distro) {
    const [cmakePath, gccPath, clangPath] = await Promise.all([
        wslWhich(distro, 'cmake'),
        wslWhich(distro, 'gcc'),
        wslWhich(distro, 'clang'),
    ]);
    if (!cmakePath) {
        // No point offering a WSL toolchain that can't drive CMake at all.
        return [];
    }
    const toolchains = [];
    if (gccPath) {
        toolchains.push({
            id: `wsl-${distro}-gcc`,
            kind: 'wsl-gcc',
            displayName: `WSL: ${distro} (gcc)`,
            compilerPath: gccPath,
            arch: 'x64',
            wslDistro: distro,
            detectedAt: Date.now(),
        });
    }
    if (clangPath) {
        toolchains.push({
            id: `wsl-${distro}-clang`,
            kind: 'wsl-clang',
            displayName: `WSL: ${distro} (clang)`,
            compilerPath: clangPath,
            arch: 'x64',
            wslDistro: distro,
            detectedAt: Date.now(),
        });
    }
    return toolchains;
}
async function detectWsl() {
    let stdout;
    try {
        ({ stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le', timeout: 3000 }));
    }
    catch {
        return [];
    }
    const distros = parseWslDistroList(stdout);
    const results = await Promise.all(distros.map((distro) => detectWslDistro(distro)));
    return results.flat();
}
// ---- MSVC dev environment (INCLUDE/LIB/LIBPATH/PATH) ----
//
// cl.exe/link.exe don't work with a bare PATH entry — they need the environment
// VsDevCmd.bat sets up (LIB/LIBPATH point at the CRT and Windows SDK import libs
// like kernel32.lib). Presets using the Ninja generator get none of that for free
// the way the Visual Studio generator would, so it has to be captured and merged
// into the spawn env before running cmake/ninja against an MSVC toolchain.
/** Parses `cmd /c "... && set"` output into a plain env map. */
function parseSetOutput(raw) {
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx <= 0) {
            continue;
        }
        env[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return env;
}
const msvcEnvCache = new Map();
/** Runs VsDevCmd.bat for `toolchain` and returns the resulting environment, cached per toolchain id. */
async function getMsvcDevEnvironment(toolchain) {
    if (toolchain.kind !== 'msvc' || !toolchain.installPath) {
        return undefined;
    }
    const cached = msvcEnvCache.get(toolchain.id);
    if (cached) {
        return cached;
    }
    const vsDevCmd = path.join(toolchain.installPath, 'Common7', 'Tools', 'VsDevCmd.bat');
    if (!(await pathExists(vsDevCmd))) {
        return undefined;
    }
    try {
        // The extra outer quote pair is required: cmd.exe's /c only strips a wrapping quote pair
        // when the *entire* remaining command line is one quoted span, not just the .bat path.
        // Without it, cmd.exe misparses "C:\Program Files\..." as the program name at the first
        // space (`'C:\Program' is not recognized...`) despite the path's own quotes.
        const { stdout } = await execFileAsync('cmd.exe', ['/d', '/s', '/c', `""${vsDevCmd}" -arch=${toolchain.arch} -host_arch=${toolchain.arch} >NUL && set"`], { windowsVerbatimArguments: true });
        const env = parseSetOutput(stdout);
        msvcEnvCache.set(toolchain.id, env);
        return env;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=toolchainRegistry.js.map