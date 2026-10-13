import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathDirs(): string[] {
  return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}

/** File names to try for `name`: on Windows the PATHEXT variants (`claude.cmd`, `cmake.exe`), unless it already has an extension. */
export function executableNames(
  name: string,
  isWindows: boolean = process.platform === 'win32',
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (!isWindows || path.extname(name)) {
    return [name];
  }
  return (pathext || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map(ext => name + ext.toLowerCase());
}

/** Directories tools commonly live in without being on the extension host's PATH. */
export function extraToolDirs(): string[] {
  const home = os.homedir();
  const dirs = [path.join(home, '.cargo', 'bin')];
  if (process.platform === 'win32') {
    dirs.push(
      'C:\Program Files\LLVM\bin',
      'C:\Program Files (x86)\LLVM\bin',
      'C:\LLVM\bin',
      path.join(home, 'scoop', 'apps', 'llvm', 'current', 'bin'),
      path.join(home, 'AppData', 'Local', 'Programs', 'LLVM', 'bin'),
    );
  }
  return dirs;
}

/** First match for `name` in `dirs` (default: PATH, then the well-known extra dirs). PATH is read at call time but fixed at host launch. */
export function findExecutable(
  name: string,
  dirs: readonly string[] = [...pathDirs(), ...extraToolDirs()],
): string | null {
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

export function findExecutableOnPath(name: string): string | null {
  return findExecutable(name, pathDirs());
}

export function findBundledBinary(extensionPath: string, binaryName: string): string | null {
  const nameWithExt = process.platform === 'win32' && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName;
  const candidate = path.join(extensionPath, 'bin', nameWithExt);
  return isFile(candidate) ? candidate : null;
}

function findConfiguredOrBundled(name: string, configuredPath?: string, extensionPath?: string, dirs?: readonly string[]): string | null {
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
  // 3. PATH plus the well-known install dirs (cargo bin, LLVM). Callers spawn the result without a shell, so on Windows
  //    only a real .exe qualifies, never a .cmd/.bat shim.
  return findExecutable(process.platform === 'win32' ? `${name}.exe` : name, dirs);
}

export function findClangFormatPath(configuredPath?: string, extensionPath?: string, dirs?: readonly string[]): string | null {
  return findConfiguredOrBundled('clang-format', configuredPath, extensionPath, dirs);
}

export function findRustfmtPath(configuredPath?: string, extensionPath?: string, dirs?: readonly string[]): string | null {
  return findConfiguredOrBundled('rustfmt', configuredPath, extensionPath, dirs);
}
