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
  /** VS install root (e.g. `...\2022\Community`), only set for `kind: 'msvc'` — used to locate VsDevCmd.bat. */
  installPath?: string;
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

export async function pathExists(candidate: string): Promise<boolean> {
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
  ], { timeout: 3000 });
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
    // The numerically newest MSVC toolset directory isn't always a complete install (e.g. a
    // partially-applied VS update can leave a newer version directory with no x64 host
    // compiler) - fall back through older versions until one actually has a working cl.exe.
    let remaining = versions;
    let latest: string | undefined;
    let compilerPath: string | undefined;
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

export function parseClangVersion(output: string): string | undefined {
  return /clang version ([\d.]+)/i.exec(output)?.[1];
}

let executableFinder: (name: string) => string | null = () => null;

/** Points executable lookup at null-env's `findExecutable`. Injected so this module stays free of `vscode` and its tests run in plain Node. */
export function setExecutableFinder(finder: (name: string) => string | null): void {
  executableFinder = finder;
}

export async function findOnPath(exeName: string): Promise<string | undefined> {
  return executableFinder(exeName) ?? undefined;
}

async function detectClangAt(
  compilerPath: string,
  idPrefix: string,
  displayPrefix: string
): Promise<Toolchain | undefined> {
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

export async function findClangxx(): Promise<{ compilerPath: string; isWsl: boolean; wslDistro?: string } | undefined> {
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
      timeout: 3000,
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
    ({ stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le', timeout: 3000 }));
  } catch {
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
export function parseSetOutput(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

const msvcEnvCache = new Map<string, Record<string, string>>();

/** Runs VsDevCmd.bat for `toolchain` and returns the resulting environment, cached per toolchain id. */
export async function getMsvcDevEnvironment(toolchain: Toolchain): Promise<Record<string, string> | undefined> {
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
    const { stdout } = await execFileAsync(
      'cmd.exe',
      ['/d', '/s', '/c', `""${vsDevCmd}" -arch=${toolchain.arch} -host_arch=${toolchain.arch} >NUL && set"`],
      { windowsVerbatimArguments: true }
    );
    const env = parseSetOutput(stdout);
    msvcEnvCache.set(toolchain.id, env);
    return env;
  } catch {
    return undefined;
  }
}
