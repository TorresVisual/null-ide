import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toWslPath } from './wslPath';
import type { ToolchainKind } from './toolchainRegistry';

export interface DebugConfig {
  type: 'lldb' | 'cppdbg';
  name: string;
  request: 'launch';
  program: string;
  args: string[];
  cwd: string;
  MIMode?: 'gdb' | 'lldb';
  miDebuggerPath?: string;
  pipeTransport?: {
    pipeProgram: string;
    pipeArgs: string[];
    debuggerPath: string;
  };
}

export interface NativeDebugger {
  mode: 'gdb' | 'lldb';
  path: string;
}

export interface DebugConfigParams {
  targetName: string;
  /** Windows-style path, even for a WSL target — matches how CMakeTarget.artifactPath is always stored. */
  artifactPath: string;
  sourceDir: string;
  toolchainKind: ToolchainKind;
  /** The toolchain's compiler executable — used to tell clang-cl apart from plain clang (same `kind`, different debug info format). */
  compilerPath: string;
  wslDistro?: string;
  /** Resolved gdb/lldb executable for a native (non-MSVC, non-clang-cl, non-WSL) toolchain. Ignored otherwise. */
  nativeDebugger?: NativeDebugger;
}

/**
 * clang-cl targets MSVC ABI parity, including PDB (CodeView) debug info instead of DWARF — GDB
 * can't read that at all, and neither can `cppvsdbg`, Microsoft's own PDB-capable engine: it
 * wraps a proprietary `vsdbg.exe` that actively refuses to run on any non-Microsoft-branded VS
 * Code build (added in cpptools 1.24.5, no way around it from the extension side). CodeLLDB's
 * bundled LLDB has grown enough Windows PDB support to stand in for both. Plain `clang.exe`
 * doesn't have the PDB-vs-DWARF distinction in `ToolchainKind` (both share `kind: 'clang'`), so
 * it's told apart by the compiler executable's basename instead.
 */
export function usesPdbDebugInfo(toolchainKind: ToolchainKind, compilerPath: string): boolean {
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
export function synthDebugConfig(params: DebugConfigParams): DebugConfig {
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
      program: toWslPath(artifactPath),
      args: [],
      cwd: toWslPath(sourceDir),
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
    throw new Error(
      `Cannot synthesize a debug config for "${targetName}": no gdb or lldb found on PATH.`
    );
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

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefers GDB — plain `lldb.exe` from the upstream LLVM Windows installer doesn't implement the
 * MI protocol MIEngine speaks (`--interpreter=mi` fails with "unknown option" or just hangs);
 * only the old, unmaintained `lldb-mi.exe` wrapper did, so that's the only lldb build worth
 * finding on PATH here. Undefined if neither is found.
 */
export async function resolveNativeDebugger(): Promise<NativeDebugger | undefined> {
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
