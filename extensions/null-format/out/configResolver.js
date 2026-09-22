"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findConfigFileUpwards = findConfigFileUpwards;
exports.resolveClangFormatStyle = resolveClangFormatStyle;
exports.formatYamlToClangFormatStyleArg = formatYamlToClangFormatStyleArg;
exports.resolveRustfmtConfig = resolveRustfmtConfig;
exports.formatTomlToRustfmtConfigArg = formatTomlToRustfmtConfigArg;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Searches upward from startDir for any of the candidate file names.
 * Stops at stopDir if provided, or at root.
 */
function findConfigFileUpwards(startDir, candidateNames, stopDir) {
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
function resolveClangFormatStyle(targetFilePath, customConfigPath, defaultConfigYaml, workspaceRoot) {
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
function formatYamlToClangFormatStyleArg(yamlStr) {
    const lines = yamlStr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const entries = [];
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
function resolveRustfmtConfig(targetFilePath, customConfigPath, defaultConfigToml, workspaceRoot) {
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
function formatTomlToRustfmtConfigArg(tomlStr) {
    const lines = tomlStr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const entries = [];
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
//# sourceMappingURL=configResolver.js.map