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
exports.synthDebugConfig = synthDebugConfig;
exports.resolveNativeDebugger = resolveNativeDebugger;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const wslPath_1 = require("./wslPath");
/**
 * Builds a `vscode.DebugConfiguration`-shaped object for the active toolchain — MSVC, native
 * Clang/GCC, or WSL. MIEngine (the `cppdbg` debug adapter) doesn't auto-discover gdb/lldb from
 * PATH the way its default-value docs imply — omitting `miDebuggerPath` fails at launch with
 * "Unable to determine path to debugger", so it must always be resolved and passed explicitly
 * for the native path (the WSL path already pins one via `pipeTransport.debuggerPath`).
 */
function synthDebugConfig(params) {
    const { targetName, artifactPath, sourceDir, toolchainKind, wslDistro, nativeDebugger } = params;
    const name = `Debug ${targetName}`;
    if (toolchainKind === 'msvc') {
        return { type: 'cppvsdbg', name, request: 'launch', program: artifactPath, args: [], cwd: sourceDir };
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
                pipeArgs: ['-d', wslDistro],
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
/** Prefers LLDB when it's on PATH (typical alongside a native Clang install), else falls back to GDB. Undefined if neither is found. */
async function resolveNativeDebugger() {
    const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, 'lldb.exe');
        if (await pathExists(candidate)) {
            return { mode: 'lldb', path: candidate };
        }
    }
    for (const dir of dirs) {
        const candidate = path.join(dir, 'gdb.exe');
        if (await pathExists(candidate)) {
            return { mode: 'gdb', path: candidate };
        }
    }
    return undefined;
}
//# sourceMappingURL=debugConfigSynth.js.map