import * as path from 'node:path';
import { fromWslPath } from './wslPath';

export interface BuildDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface ResolvedBuildDiagnostic extends BuildDiagnostic {
  absolutePath: string;
}

// MSVC-style: `path(line,col): error C2065: message` — cl.exe always has an error code, but
// clang-cl (MSVC-compatible diagnostics, e.g. `clang-cl.exe` builds) omits it, so it's optional.
const MSVC_RE = /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)(?:\s+([A-Za-z]+\d+))?\s*:\s*(.*)$/;
// Clang/GCC: `path:line:col: error: message`
const GCC_CLANG_RE = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.*)$/;

function severityOf(raw: string): 'error' | 'warning' {
  return raw === 'warning' ? 'warning' : 'error';
}

/** Parses a single line of `cmake --build` output for an MSVC or Clang/GCC diagnostic. */
export function parseBuildDiagnosticLine(line: string): BuildDiagnostic | undefined {
  const msvc = MSVC_RE.exec(line);
  if (msvc) {
    const code = msvc[5];
    return {
      file: msvc[1],
      line: Number(msvc[2]),
      column: msvc[3] ? Number(msvc[3]) : 1,
      severity: severityOf(msvc[4]),
      message: code ? `${code}: ${msvc[6]}` : msvc[6],
    };
  }
  const gccClang = GCC_CLANG_RE.exec(line);
  if (gccClang) {
    return {
      file: gccClang[1],
      line: Number(gccClang[2]),
      column: Number(gccClang[3]),
      severity: severityOf(gccClang[4]),
      message: gccClang[5],
    };
  }
  return undefined;
}

export function parseBuildOutput(output: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const diagnostic = parseBuildDiagnosticLine(line);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

/**
 * Resolves a diagnostic's file to a real Windows filesystem path. WSL builds emit either
 * `/mnt/<drive>/...` (translatable) or paths relative to the build cwd (same physical
 * location on both sides, since the workspace lives on a mounted Windows drive).
 */
export function resolveDiagnosticPath(
  file: string,
  sourceDir: string,
  isWsl: boolean,
  wslDistro: string | undefined
): string {
  if (isWsl && wslDistro && file.startsWith('/')) {
    return fromWslPath(file, wslDistro);
  }
  const normalized = isWsl ? file.replace(/\//g, '\\') : file;
  return path.isAbsolute(normalized) ? normalized : path.resolve(sourceDir, normalized);
}

export function resolveBuildDiagnostics(
  output: string,
  sourceDir: string,
  isWsl: boolean,
  wslDistro: string | undefined
): ResolvedBuildDiagnostic[] {
  return parseBuildOutput(output).map((d) => ({
    ...d,
    absolutePath: resolveDiagnosticPath(d.file, sourceDir, isWsl, wslDistro),
  }));
}
