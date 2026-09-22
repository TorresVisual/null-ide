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
  defaultConfigYaml?: string,
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
  const fallbackYaml = (defaultConfigYaml && defaultConfigYaml.trim().length > 0)
    ? defaultConfigYaml
    : 'BasedOnStyle: LLVM\nIndentWidth: 4\nTabWidth: 4\nUseTab: Never\nColumnLimit: 100';

  // Convert YAML / key-value lines into single-line JSON/YAML style dictionary for -style argument
  const styleArg = formatYamlToClangFormatStyleArg(fallbackYaml);
  return {
    styleArg,
    source: 'default',
  };
}

/**
 * Converts a multi-line YAML config string into clang-format's inline `-style={...}` format.
 */
export function formatYamlToClangFormatStyleArg(yamlStr: string): string {
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
  defaultConfigToml?: string,
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

  // 3. Fallback to settings defaultConfig TOML parsed into CLI options
  const fallbackToml = defaultConfigToml || 'edition = "2021"\nmax_width = 100\ntab_spaces = 4';
  const inlineOptions = formatTomlToRustfmtConfigArg(fallbackToml);

  return {
    inlineOptions,
    source: 'default',
  };
}

/**
 * Converts simple TOML key = value lines into rustfmt's `--config key=value,key=value` format.
 */
export function formatTomlToRustfmtConfigArg(tomlStr: string): string {
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
