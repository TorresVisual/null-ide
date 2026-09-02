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
  pipeTransport?: {
    pipeProgram: string;
    pipeArgs: string[];
    debuggerPath: string;
  };
}

export interface DebugConfigParams {
  targetName: string;
  /** Windows-style path, even for a WSL target — matches how CMakeTarget.artifactPath is always stored. */
  artifactPath: string;
  sourceDir: string;
  toolchainKind: ToolchainKind;
  wslDistro?: string;
  /** Which debugger is on PATH for a native (non-MSVC, non-WSL) toolchain. Ignored otherwise. */
  nativeMIMode?: 'gdb' | 'lldb';
}

/** Builds a `vscode.DebugConfiguration`-shaped object for the active toolchain — MSVC, native Clang/GCC, or WSL. */
export function synthDebugConfig(params: DebugConfigParams): DebugConfig {
  const { targetName, artifactPath, sourceDir, toolchainKind, wslDistro, nativeMIMode } = params;
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

  return {
    type: 'cppdbg',
    name,
    request: 'launch',
    program: artifactPath,
    args: [],
    cwd: sourceDir,
    MIMode: nativeMIMode ?? 'gdb',
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

/** Prefers LLDB when it's on PATH (typical alongside a native Clang install), else falls back to GDB. */
export async function resolveNativeMIMode(): Promise<'gdb' | 'lldb'> {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (await pathExists(path.join(dir, 'lldb.exe'))) {
      return 'lldb';
    }
  }
  return 'gdb';
}
