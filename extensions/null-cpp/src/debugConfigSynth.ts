import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toWslPath } from './wslPath';
import type { ToolchainKind } from './toolchainRegistry';

export interface DebugConfig {
  type: 'cppvsdbg' | 'cppdbg';
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
  wslDistro?: string;
  /** Resolved gdb/lldb executable for a native (non-MSVC, non-WSL) toolchain. Ignored otherwise. */
  nativeDebugger?: NativeDebugger;
}

/**
 * Builds a `vscode.DebugConfiguration`-shaped object for the active toolchain — MSVC, native
 * Clang/GCC, or WSL. MIEngine (the `cppdbg` debug adapter) doesn't auto-discover gdb/lldb from
 * PATH the way its default-value docs imply — omitting `miDebuggerPath` fails at launch with
 * "Unable to determine path to debugger", so it must always be resolved and passed explicitly
 * for the native path (the WSL path already pins one via `pipeTransport.debuggerPath`).
 */
export function synthDebugConfig(params: DebugConfigParams): DebugConfig {
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
      program: toWslPath(artifactPath),
      args: [],
      cwd: toWslPath(sourceDir),
      MIMode: 'gdb',
      pipeTransport: {
        pipeProgram: 'wsl.exe',
        pipeArgs: ['-d', wslDistro],
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

/** Prefers LLDB when it's on PATH (typical alongside a native Clang install), else falls back to GDB. Undefined if neither is found. */
export async function resolveNativeDebugger(): Promise<NativeDebugger | undefined> {
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
