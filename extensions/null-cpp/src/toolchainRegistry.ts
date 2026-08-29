import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export type ToolchainKind = 'msvc' | 'clang' | 'gcc-mingw' | 'wsl-gcc' | 'wsl-clang';

export interface Toolchain {
  id: string;
  kind: ToolchainKind;
  displayName: string;
  compilerPath: string;
  arch: string;
  wslDistro?: string;
  detectedAt: number;
}

let cached: Toolchain[] = [];

export function list(): Toolchain[] {
  return cached;
}

export async function refresh(): Promise<Toolchain[]> {
  const [msvc, clang, wsl] = await Promise.all([
    detectMsvc().catch(() => []),
    detectClang().catch(() => []),
    detectWsl().catch(() => []),
  ]);
  cached = [...msvc, ...clang, ...wsl];
  return cached;
}

// ---- MSVC ----

export function parseVswhereInstallPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function pickLatestMsvcVersion(versions: string[]): string | undefined {
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

function findVswherePath(): string {
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function detectMsvc(): Promise<Toolchain[]> {
  const vswherePath = findVswherePath();
  if (!(await pathExists(vswherePath))) {
    return [];
  }
  const { stdout } = await execFileAsync(vswherePath, [
    '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ]);
  const installPaths = parseVswhereInstallPaths(stdout);
  const toolchains: Toolchain[] = [];
  for (const installPath of installPaths) {
    const msvcToolsDir = path.join(installPath, 'VC', 'Tools', 'MSVC');
    let versions: string[];
    try {
      versions = (await fs.readdir(msvcToolsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    const latest = pickLatestMsvcVersion(versions);
    if (!latest) {
      continue;
    }
    const compilerPath = path.join(msvcToolsDir, latest, 'bin', 'Hostx64', 'x64', 'cl.exe');
    if (!(await pathExists(compilerPath))) {
      continue;
    }
    toolchains.push({
      id: `msvc-${latest}-x64`,
      kind: 'msvc',
      displayName: `MSVC ${latest} (x64)`,
      compilerPath,
      arch: 'x64',
      detectedAt: Date.now(),
    });
  }
  return toolchains;
}

// ---- Clang / clang-cl ----

export function parseClangVersion(output: string): string | undefined {
  return /clang version ([\d.]+)/i.exec(output)?.[1];
}

function pathDirs(): string[] {
  return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}

async function findOnPath(exeName: string): Promise<string | undefined> {
  for (const dir of pathDirs()) {
    const candidate = path.join(dir, exeName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function detectClangAt(
  compilerPath: string,
  idPrefix: string,
  displayPrefix: string
): Promise<Toolchain | undefined> {
  try {
    const { stdout } = await execFileAsync(compilerPath, ['--version']);
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
  } catch {
    return undefined;
  }
}

async function detectClang(): Promise<Toolchain[]> {
  const toolchains: Toolchain[] = [];
  const clangCl = await findOnPath('clang-cl.exe');
  if (clangCl) {
    const t = await detectClangAt(clangCl, 'llvm-clang-cl', 'Clang-cl');
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

// ---- WSL ----

export function parseWslDistroList(raw: string): string[] {
  return raw
    .replace(/\u0000/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^windows subsystem for linux distributions/i.test(line));
}

async function wslWhich(distro: string, tool: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-d', distro, '--', 'which', tool], {
      encoding: 'utf8',
    });
    const cleaned = stdout.replace(/\u0000/g, '').trim();
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

async function detectWslDistro(distro: string): Promise<Toolchain[]> {
  const [cmakePath, gccPath, clangPath] = await Promise.all([
    wslWhich(distro, 'cmake'),
    wslWhich(distro, 'gcc'),
    wslWhich(distro, 'clang'),
  ]);
  if (!cmakePath) {
    // No point offering a WSL toolchain that can't drive CMake at all.
    return [];
  }
  const toolchains: Toolchain[] = [];
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

async function detectWsl(): Promise<Toolchain[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le' }));
  } catch {
    return [];
  }
  const distros = parseWslDistroList(stdout);
  const results = await Promise.all(distros.map((distro) => detectWslDistro(distro)));
  return results.flat();
}
