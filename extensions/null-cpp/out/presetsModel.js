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
exports.parseConfigurePresets = parseConfigurePresets;
exports.resolveAllPresets = resolveAllPresets;
exports.expandMacros = expandMacros;
exports.resolveToolchainId = resolveToolchainId;
exports.inferIsWsl = inferIsWsl;
exports.toCMakePreset = toCMakePreset;
exports.loadPresets = loadPresets;
const path = __importStar(require("node:path"));
function parseConfigurePresets(json) {
    if (!json || typeof json !== 'object') {
        return [];
    }
    const arr = json.configurePresets;
    return Array.isArray(arr) ? arr : [];
}
function mergeTwo(base, override) {
    return {
        ...base,
        ...override,
        cacheVariables: { ...(base.cacheVariables ?? {}), ...(override.cacheVariables ?? {}) },
        environment: { ...(base.environment ?? {}), ...(override.environment ?? {}) },
    };
}
function resolvePreset(name, byName, resolved, stack) {
    const cached = resolved.get(name);
    if (cached) {
        return cached;
    }
    if (stack.has(name)) {
        throw new Error(`Circular "inherits" chain detected at preset "${name}"`);
    }
    const raw = byName.get(name);
    if (!raw) {
        throw new Error(`Preset "${name}" referenced by "inherits" was not found`);
    }
    stack.add(name);
    const parentNames = raw.inherits === undefined ? [] : Array.isArray(raw.inherits) ? raw.inherits : [raw.inherits];
    // CMake gives the *first* entry of "inherits" the highest priority among parents.
    // Folding from the last parent to the first means each earlier parent overrides
    // everything accumulated so far, so the first parent ends up winning.
    let parentsMerged = { name };
    for (let i = parentNames.length - 1; i >= 0; i--) {
        const parent = resolvePreset(parentNames[i], byName, resolved, stack);
        parentsMerged = mergeTwo(parentsMerged, parent);
    }
    const merged = mergeTwo(parentsMerged, { ...raw, name });
    // "hidden" is never inherited: a base preset is typically marked hidden so it can't be
    // selected directly, but that must not silently hide every preset that inherits from it.
    merged.hidden = raw.hidden ?? false;
    stack.delete(name);
    resolved.set(name, merged);
    return merged;
}
/** Resolves every preset's `inherits` chain into a flat, fully-merged preset. */
function resolveAllPresets(rawPresets) {
    const byName = new Map(rawPresets.map((p) => [p.name, p]));
    const resolved = new Map();
    return rawPresets.map((p) => resolvePreset(p.name, byName, resolved, new Set()));
}
function expandMacros(value, ctx) {
    return value
        .replace(/\$\{sourceDir\}/g, ctx.sourceDir)
        .replace(/\$\{sourceParentDir\}/g, path.dirname(ctx.sourceDir))
        .replace(/\$\{sourceDirName\}/g, path.basename(ctx.sourceDir))
        .replace(/\$\{presetName\}/g, ctx.presetName);
}
function cacheVarString(raw, key) {
    const value = raw.cacheVariables?.[key];
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && typeof value.value === 'string') {
        return value.value;
    }
    return undefined;
}
function basename(p) {
    return p.replace(/\\/g, '/').split('/').pop() ?? p;
}
/**
 * Maps a C++-driver executable name (what presets set for CMAKE_CXX_COMPILER)
 * to the executable name toolchain detection actually probes for. `g++` isn't
 * `gcc` with a suffix stripped — it's a distinct binary — so this needs an
 * explicit alias rather than a string transform.
 */
const COMPILER_FAMILY_ALIASES = {
    'g++': 'gcc',
    'clang++': 'clang',
};
function normalizeCompilerFamily(name) {
    return COMPILER_FAMILY_ALIASES[name] ?? name;
}
/** Matches a preset's configured compiler against a detected toolchain by executable basename. */
function resolveToolchainId(raw, toolchains) {
    const compiler = cacheVarString(raw, 'CMAKE_CXX_COMPILER') ?? cacheVarString(raw, 'CMAKE_C_COMPILER');
    if (!compiler) {
        return '';
    }
    const compilerBase = normalizeCompilerFamily(basename(compiler).toLowerCase());
    return (toolchains.find((t) => normalizeCompilerFamily(basename(t.compilerPath).toLowerCase()) === compilerBase)?.id ??
        '');
}
function looksLikePosixPath(value) {
    return typeof value === 'string' && value.startsWith('/');
}
/**
 * A preset targets WSL if it opts in explicitly via `vendor["null-cpp"].wsl`, or — absent
 * that — if it uses a Unix-style generator with a POSIX compiler/build path, since
 * CMakePresets.json has no first-class "toolchain" concept to read this from directly.
 */
function inferIsWsl(raw) {
    const vendorFlag = raw.vendor?.['null-cpp']?.wsl;
    if (typeof vendorFlag === 'boolean') {
        return vendorFlag;
    }
    const generator = (raw.generator ?? '').trim();
    if (!/^(unix makefiles|ninja)$/i.test(generator)) {
        return false;
    }
    const compiler = cacheVarString(raw, 'CMAKE_CXX_COMPILER') ?? cacheVarString(raw, 'CMAKE_C_COMPILER');
    return looksLikePosixPath(compiler) || looksLikePosixPath(raw.binaryDir);
}
function toCMakePreset(raw, sourceDir, toolchains) {
    const binaryDirRaw = raw.binaryDir ?? '${sourceDir}/build/${presetName}';
    return {
        name: raw.name,
        displayName: raw.displayName ?? raw.name,
        generator: raw.generator ?? '',
        binaryDir: expandMacros(binaryDirRaw, { sourceDir, presetName: raw.name }),
        toolchainId: resolveToolchainId(raw, toolchains),
        isWsl: inferIsWsl(raw),
    };
}
/** Parses, merges (`inherits`), and resolves every non-hidden configure preset for a workspace. */
function loadPresets(mainJson, userJson, sourceDir, toolchains) {
    const raws = [...parseConfigurePresets(mainJson), ...parseConfigurePresets(userJson)];
    const resolved = resolveAllPresets(raws);
    return resolved.filter((r) => !r.hidden).map((r) => toCMakePreset(r, sourceDir, toolchains));
}
//# sourceMappingURL=presetsModel.js.map