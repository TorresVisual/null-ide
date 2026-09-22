import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function findExecutableOnPath(executableName: string): string | null {
  const isWindows = process.platform === 'win32';
  const nameWithExt = isWindows && !executableName.endsWith('.exe')
    ? `${executableName}.exe`
    : executableName;

  const pathEnv = process.env.PATH || '';
  const pathSeparator = isWindows ? ';' : ':';
  const directories = pathEnv.split(pathSeparator);

  for (const dir of directories) {
    if (!dir) continue;
    const fullPath = path.join(dir, nameWithExt);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    } catch {
      // Ignore permission or stat errors
    }
  }

  return null;
}

export function findBundledBinary(extensionPath: string, binaryName: string): string | null {
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

export function findClangFormatPath(
  configuredPath?: string,
  extensionPath?: string
): string | null {
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

export function findRustfmtPath(
  configuredPath?: string,
  extensionPath?: string
): string | null {
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
