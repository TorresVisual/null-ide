import * as fs from 'fs';
import * as path from 'path';

/**
 * Searches upward from startDir for any of the candidate file names.
 * Stops at stopDir if provided, or at root.
 */
export function findConfigFileUpwards(
  startDir: string,
  candidateNames: string[],
  stopDir?: string
): string | null {
  let currentDir = path.resolve(startDir);
  const normalizedStopDir = stopDir ? path.resolve(stopDir) : undefined;

  while (true) {
    for (const name of candidateNames) {
      const candidatePath = path.join(currentDir, name);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return candidatePath;
      }
    }

    if (normalizedStopDir && currentDir === normalizedStopDir) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

export interface ClangFormatConfigResolution {
  styleArg: string;
  source: 'workspace' | 'custom' | 'default';
  configFilePath?: string;
}

export function resolveClangFormatStyle(
  targetFilePath: string,
  customConfigPath?: string,
  defaultConfig?: string | Record<string, unknown>,
  workspaceRoot?: string
): ClangFormatConfigResolution {
  // 1. Custom config path specified in settings
  if (customConfigPath && customConfigPath.trim().length > 0) {
    const resolvedCustom = path.isAbsolute(customConfigPath)
      ? customConfigPath
      : workspaceRoot
      ? path.join(workspaceRoot, customConfigPath)
      : customConfigPath;

    if (fs.existsSync(resolvedCustom)) {
      return {
        styleArg: `file:${resolvedCustom}`,
        source: 'custom',
        configFilePath: resolvedCustom,
      };
    }
  }

  // 2. Search for .clang-format or _clang-format in workspace hierarchy
  const targetDir = path.dirname(targetFilePath);
  const foundFile = findConfigFileUpwards(targetDir, ['.clang-format', '_clang-format'], workspaceRoot);
  if (foundFile) {
    return {
      styleArg: `file:${foundFile}`,
      source: 'workspace',
      configFilePath: foundFile,
    };
  }

  // 3. Fallback to settings defaultConfig
  const styleArg = formatYamlToClangFormatStyleArg(defaultConfig || '');
  return {
    styleArg,
    source: 'default',
  };
}

/**
 * Converts a multi-line YAML config string or object dictionary into clang-format's inline `-style={...}` format.
 */
export function formatYamlToClangFormatStyleArg(input: string | Record<string, unknown>): string {
  if (typeof input === 'object' && input !== null) {
    const entries = Object.entries(input)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${v}`);
    if (entries.length === 0) {
      return '{BasedOnStyle: LLVM}';
    }
    return `{${entries.join(', ')}}`;
  }

  const yamlStr = (typeof input === 'string' && input.trim().length > 0)
    ? input
    : 'BasedOnStyle: LLVM\nIndentWidth: 4\nTabWidth: 4\nUseTab: Never\nColumnLimit: 100';

  const lines = yamlStr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const entries: string[] = [];

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key && value) {
        entries.push(`${key}: ${value}`);
      }
    }
  }

  if (entries.length === 0) {
    return '{BasedOnStyle: LLVM}';
  }

  return `{${entries.join(', ')}}`;
}

export interface RustfmtConfigResolution {
  configPath?: string;
  inlineOptions?: string;
  source: 'workspace' | 'custom' | 'default';
}

export function resolveRustfmtConfig(
  targetFilePath: string,
  customConfigPath?: string,
  defaultConfig?: string | Record<string, unknown>,
  workspaceRoot?: string
): RustfmtConfigResolution {
  // 1. Custom config path
  if (customConfigPath && customConfigPath.trim().length > 0) {
    const resolvedCustom = path.isAbsolute(customConfigPath)
      ? customConfigPath
      : workspaceRoot
      ? path.join(workspaceRoot, customConfigPath)
      : customConfigPath;

    if (fs.existsSync(resolvedCustom)) {
      return {
        configPath: resolvedCustom,
        source: 'custom',
      };
    }
  }

  // 2. Search for rustfmt.toml or .rustfmt.toml
  const targetDir = path.dirname(targetFilePath);
  const foundFile = findConfigFileUpwards(targetDir, ['rustfmt.toml', '.rustfmt.toml'], workspaceRoot);
  if (foundFile) {
    return {
      configPath: foundFile,
      source: 'workspace',
    };
  }

  // 3. Fallback to settings defaultConfig TOML or object parsed into CLI options
  const inlineOptions = formatTomlToRustfmtConfigArg(defaultConfig || '');

  return {
    inlineOptions,
    source: 'default',
  };
}

/**
 * Converts simple TOML key = value lines or object key-values into rustfmt's `--config key=value,key=value` format.
 */
export function formatTomlToRustfmtConfigArg(input: string | Record<string, unknown>): string {
  if (typeof input === 'object' && input !== null) {
    const entries = Object.entries(input)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => {
        if (typeof v === 'string' && !v.startsWith('"')) {
          return `${k}="${v}"`;
        }
        return `${k}=${v}`;
      });
    return entries.join(',');
  }

  const tomlStr = (typeof input === 'string' && input.trim().length > 0)
    ? input
    : 'edition = "2021"\nmax_width = 100\ntab_spaces = 4';

  const lines = tomlStr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const entries: string[] = [];

  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      // Keep or strip quotes properly for CLI arg
      if (key && value) {
        entries.push(`${key}=${value}`);
      }
    }
  }

  return entries.join(',');
}
