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
exports.usesPdbDebugInfo = usesPdbDebugInfo;
exports.synthDebugConfig = synthDebugConfig;
exports.resolveNativeDebugger = resolveNativeDebugger;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const wslPath_1 = require("./wslPath");
/**
 * clang-cl targets MSVC ABI parity, including PDB (CodeView) debug info instead of DWARF — GDB
 * can't read that at all, and neither can `cppvsdbg`, Microsoft's own PDB-capable engine: it
 * wraps a proprietary `vsdbg.exe` that actively refuses to run on any non-Microsoft-branded VS
 * Code build (added in cpptools 1.24.5, no way around it from the extension side). CodeLLDB's
 * bundled LLDB has grown enough Windows PDB support to stand in for both. Plain `clang.exe`
 * doesn't have the PDB-vs-DWARF distinction in `ToolchainKind` (both share `kind: 'clang'`), so
 * it's told apart by the compiler executable's basename instead.
 */
function usesPdbDebugInfo(toolchainKind, compilerPath) {
    return toolchainKind === 'msvc' || path.basename(compilerPath).toLowerCase() === 'clang-cl.exe';
}
/**
 * Builds a `vscode.DebugConfiguration`-shaped object for the active toolchain — MSVC/clang-cl
 * (via CodeLLDB, `type: 'lldb'`), native Clang/GCC, or WSL (both via `cppdbg`). MIEngine (the
 * `cppdbg` debug adapter) doesn't auto-discover gdb/lldb from PATH the way its default-value
 * docs imply — omitting `miDebuggerPath` fails at launch with "Unable to determine path to
 * debugger", so it must always be resolved and passed explicitly for the native path (the WSL
 * path already pins one via `pipeTransport.debuggerPath`; CodeLLDB bundles its own LLDB, so the
 * PDB path needs neither).
 */
function synthDebugConfig(params) {
    const { targetName, artifactPath, sourceDir, toolchainKind, compilerPath, wslDistro, nativeDebugger } = params;
    const name = `Debug ${targetName}`;
    if (usesPdbDebugInfo(toolchainKind, compilerPath)) {
        return { type: 'lldb', name, request: 'launch', program: artifactPath, args: [], cwd: sourceDir };
    }
    if (toolchainKind === 'wsl-gcc' || toolchainKind === 'wsl-clang') {
        if (!wslDistro) {
            throw new Error(`Cannot synthesize a WSL debug config for "${targetName}": no WSL distro given.`);
        }
        return {
            type: 'cppdbg',
            name,
            request: 'launch',
            program: (0, wslPath_1.toWslPath)(artifactPath),
            args: [],
            cwd: (0, wslPath_1.toWslPath)(sourceDir),
            MIMode: 'gdb',
            pipeTransport: {
                pipeProgram: 'wsl.exe',
                // MIEngine hands `${debuggerPath} ${miArgs...}` to pipeProgram as a single quoted argv
                // token, not split into separate arguments. wsl.exe's default shell then tries to exec
                // that whole string as one literal filename ("/usr/bin/gdb --interpreter=mi: No such
                // file or directory") unless it's routed through a shell that re-splits it — hence the
                // trailing `bash -c`.
                pipeArgs: ['-d', wslDistro, 'bash', '-c'],
                debuggerPath: '/usr/bin/gdb',
            },
        };
    }
    if (!nativeDebugger) {
        throw new Error(`Cannot synthesize a debug config for "${targetName}": no gdb or lldb found on PATH.`);
    }
    return {
        type: 'cppdbg',
        name,
        request: 'launch',
        program: artifactPath,
        args: [],
        cwd: sourceDir,
        MIMode: nativeDebugger.mode,
        miDebuggerPath: nativeDebugger.path,
    };
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
/**
 * Prefers GDB — plain `lldb.exe` from the upstream LLVM Windows installer doesn't implement the
 * MI protocol MIEngine speaks (`--interpreter=mi` fails with "unknown option" or just hangs);
 * only the old, unmaintained `lldb-mi.exe` wrapper did, so that's the only lldb build worth
 * finding on PATH here. Undefined if neither is found.
 */
async function resolveNativeDebugger() {
    const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, 'gdb.exe');
        if (await pathExists(candidate)) {
            return { mode: 'gdb', path: candidate };
        }
    }
    for (const dir of dirs) {
        const candidate = path.join(dir, 'lldb-mi.exe');
        if (await pathExists(candidate)) {
            return { mode: 'lldb', path: candidate };
        }
    }
    return undefined;
}
//# sourceMappingURL=debugConfigSynth.js.map