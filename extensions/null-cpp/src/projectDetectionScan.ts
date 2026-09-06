import * as fs from 'fs';
import * as path from 'path';

// Definitive project/build config for a C/C++ project.
const STRONG_FILENAMES = new Set([
  'CMakeLists.txt',
  'compile_commands.json',
  '.clangd',
  'meson.build',
  'Makefile',
  'makefile',
  'GNUmakefile',
  'BUILD',
  'BUILD.bazel',
  'WORKSPACE',
  'WORKSPACE.bazel',
]);
const STRONG_EXTENSIONS = ['.vcxproj', '.vcxproj.filters'];

// A source/header file alone is weaker evidence: plenty of repos carry an
// incidental or vendored C/C++ file without being a C++ project.
const WEAK_EXTENSIONS = ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'];

// Dependency/vendor directories: never descended into, so nothing inside
// (strong or weak) ever counts as evidence.
const PRUNED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'vendors',
  'third_party',
  'third-party',
  'external',
  '.cache',
  'site-packages'
]);

// Build/output directories: still descended into (a generated
// compile_commands.json here is genuine evidence), but source/header files
// found here are generated or intermediate, not real evidence.
const WEAK_EXCLUDED_DIRS = new Set(['build', 'out', 'dist', 'target', 'bin', 'obj']);

// ponytail: naive cap on directories visited so a pathological/huge tree can't hang
// activation; bump this or switch to VS Code's indexed search if it proves too small.
const MAX_DIRS_SCANNED = 2000;

function isStrongEvidence(filename: string): boolean {
  return STRONG_FILENAMES.has(filename) || STRONG_EXTENSIONS.some(ext => filename.endsWith(ext));
}

function isWeakEvidence(filename: string): boolean {
  return WEAK_EXTENSIONS.some(ext => filename.endsWith(ext));
}

/**
 * Finds the nearest (shallowest) directory containing a CMakeLists.txt, BFS from rootDir.
 * Used when the workspace root itself isn't a CMake project root — e.g. a monorepo where the
 * CMake project lives in a subfolder (this repo's own shell-ext/).
 */
export function findNearestCMakeListsDir(rootDir: string): string | undefined {
  const queue: string[] = [rootDir];
  let dirsScanned = 0;

  while (queue.length > 0) {
    if (dirsScanned++ >= MAX_DIRS_SCANNED) {
      break;
    }
    const dir = queue.shift()!;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'CMakeLists.txt')) {
      return dir;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !PRUNED_DIRS.has(entry.name)) {
        queue.push(path.join(dir, entry.name));
      }
    }
  }
  return undefined;
}

/** Recursively scans a directory for C/C++ project evidence. Pure Node fs, no vscode dependency. */
export function scanDirectoryForCppProject(rootDir: string): boolean {
  const stack: Array<{ dir: string; weakExcluded: boolean }> = [{ dir: rootDir, weakExcluded: false }];
  let dirsScanned = 0;

  while (stack.length > 0) {
    if (dirsScanned++ >= MAX_DIRS_SCANNED) {
      break;
    }
    const { dir, weakExcluded } = stack.pop()!;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name)) {
          continue;
        }
        stack.push({
          dir: path.join(dir, entry.name),
          weakExcluded: weakExcluded || WEAK_EXCLUDED_DIRS.has(entry.name),
        });
      } else if (entry.isFile()) {
        if (isStrongEvidence(entry.name)) {
          return true;
        }
        if (!weakExcluded && isWeakEvidence(entry.name)) {
          return true;
        }
      }
    }
  }
  return false;
}
