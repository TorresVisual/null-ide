import * as path from 'node:path';
import type { Toolchain } from './toolchainRegistry';

export interface RawCMakePreset {
  name: string;
  displayName?: string;
  hidden?: boolean;
  inherits?: string | string[];
  generator?: string;
  binaryDir?: string;
  cacheVariables?: Record<string, unknown>;
  environment?: Record<string, string>;
  vendor?: Record<string, unknown>;
}

export interface CMakePreset {
  name: string;
  displayName: string;
  generator: string;
  binaryDir: string;
  toolchainId: string;
  isWsl: boolean;
}

export function parseConfigurePresets(json: unknown): RawCMakePreset[] {
  if (!json || typeof json !== 'object') {
    return [];
  }
  const arr = (json as { configurePresets?: unknown }).configurePresets;
  return Array.isArray(arr) ? (arr as RawCMakePreset[]) : [];
}

function mergeTwo(base: RawCMakePreset, override: RawCMakePreset): RawCMakePreset {
  return {
    ...base,
    ...override,
    cacheVariables: { ...(base.cacheVariables ?? {}), ...(override.cacheVariables ?? {}) },
    environment: { ...(base.environment ?? {}), ...(override.environment ?? {}) },
  };
}

function resolvePreset(
  name: string,
  byName: Map<string, RawCMakePreset>,
  resolved: Map<string, RawCMakePreset>,
  stack: Set<string>
): RawCMakePreset {
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
  let parentsMerged: RawCMakePreset = { name };
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
export function resolveAllPresets(rawPresets: RawCMakePreset[]): RawCMakePreset[] {
  const byName = new Map(rawPresets.map((p) => [p.name, p]));
  const resolved = new Map<string, RawCMakePreset>();
  return rawPresets.map((p) => resolvePreset(p.name, byName, resolved, new Set()));
}

export function expandMacros(value: string, ctx: { sourceDir: string; presetName: string }): string {
  return value
    .replace(/\$\{sourceDir\}/g, ctx.sourceDir)
    .replace(/\$\{sourceParentDir\}/g, path.dirname(ctx.sourceDir))
    .replace(/\$\{sourceDirName\}/g, path.basename(ctx.sourceDir))
    .replace(/\$\{presetName\}/g, ctx.presetName);
}

function cacheVarString(raw: RawCMakePreset, key: string): string | undefined {
  const value = raw.cacheVariables?.[key];
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
    return (value as { value: string }).value;
  }
  return undefined;
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

/** Matches a preset's configured compiler against a detected toolchain by executable basename. */
export function resolveToolchainId(raw: RawCMakePreset, toolchains: Toolchain[]): string {
  const compiler = cacheVarString(raw, 'CMAKE_CXX_COMPILER') ?? cacheVarString(raw, 'CMAKE_C_COMPILER');
  if (!compiler) {
    return '';
  }
  const compilerBase = basename(compiler).toLowerCase();
  return toolchains.find((t) => basename(t.compilerPath).toLowerCase() === compilerBase)?.id ?? '';
}

function looksLikePosixPath(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('/');
}

/**
 * A preset targets WSL if it opts in explicitly via `vendor["null-cpp"].wsl`, or — absent
 * that — if it uses a Unix-style generator with a POSIX compiler/build path, since
 * CMakePresets.json has no first-class "toolchain" concept to read this from directly.
 */
export function inferIsWsl(raw: RawCMakePreset): boolean {
  const vendorFlag = (raw.vendor?.['null-cpp'] as { wsl?: unknown } | undefined)?.wsl;
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

export function toCMakePreset(raw: RawCMakePreset, sourceDir: string, toolchains: Toolchain[]): CMakePreset {
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
export function loadPresets(
  mainJson: unknown,
  userJson: unknown,
  sourceDir: string,
  toolchains: Toolchain[]
): CMakePreset[] {
  const raws = [...parseConfigurePresets(mainJson), ...parseConfigurePresets(userJson)];
  const resolved = resolveAllPresets(raws);
  return resolved.filter((r) => !r.hidden).map((r) => toCMakePreset(r, sourceDir, toolchains));
}
