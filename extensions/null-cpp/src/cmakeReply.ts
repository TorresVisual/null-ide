import * as path from 'node:path';

export interface CMakeTarget {
  name: string;
  type: string;
  artifactPath: string;
  sourceFiles: string[];
}

/**
 * `posixCwd` is passed through `wsl.exe --cd` rather than relying on `wsl.exe`'s own
 * translation of the spawning Windows process's cwd — that auto-translation proved
 * unreliable in practice (a WSL preset's CMake cache ended up recorded with a Windows-style
 * source directory, `d:/...` instead of `/mnt/d/...`, causing later reconfigures to fail with
 * a "binary dir moved" error) so the working directory is resolved to POSIX form up front.
 */
export function wrapWslCommand(
  command: string,
  args: string[],
  distro: string,
  posixCwd?: string
): { command: string; args: string[] } {
  const cdArgs = posixCwd ? ['--cd', posixCwd] : [];
  return { command: 'wsl.exe', args: ['-d', distro, ...cdArgs, '--', command, ...args] };
}

interface ReplyIndexJson {
  reply?: Record<string, { kind?: string; jsonFile?: string } | { error: string }>;
}

export interface ReplyObjectRef {
  kind: string;
  jsonFile: string;
}

/** Picks the newest `index-*.json` reply file — CMake's timestamped names sort chronologically as strings. */
export function pickLatestIndexFile(fileNames: string[]): string | undefined {
  const indexFiles = fileNames.filter((f) => /^index-.*\.json$/.test(f)).sort();
  return indexFiles.length > 0 ? indexFiles[indexFiles.length - 1] : undefined;
}

export function parseReplyIndex(indexJson: unknown): ReplyObjectRef | undefined {
  const entry = (indexJson as ReplyIndexJson | undefined)?.reply?.['codemodel-v2'];
  if (!entry || 'error' in entry || typeof entry.jsonFile !== 'string') {
    return undefined;
  }
  return { kind: entry.kind ?? 'codemodel', jsonFile: entry.jsonFile };
}

interface CodemodelTargetRefJson {
  name: string;
  jsonFile: string;
}

interface CodemodelJson {
  configurations?: Array<{ name: string; targets?: CodemodelTargetRefJson[] }>;
}

export function parseCodemodelTargets(codemodelJson: unknown, configName?: string): CodemodelTargetRefJson[] {
  const configs = (codemodelJson as CodemodelJson | undefined)?.configurations ?? [];
  const config = configName ? configs.find((c) => c.name === configName) : configs[0];
  return config?.targets ?? [];
}

interface TargetDetailJson {
  type?: string;
  artifacts?: Array<{ path: string }>;
  sources?: Array<{ path: string }>;
}

/** Artifact paths in the File API are relative to the top-level build directory; source paths to the top-level source directory. */
export function parseTargetDetail(name: string, json: unknown, binaryDir: string): CMakeTarget {
  const detail = (json as TargetDetailJson | undefined) ?? {};
  const artifactRel = detail.artifacts?.[0]?.path;
  return {
    name,
    type: detail.type ?? 'UTILITY',
    artifactPath: artifactRel ? path.join(binaryDir, ...artifactRel.split('/')) : '',
    sourceFiles: (detail.sources ?? []).map((s) => s.path),
  };
}
