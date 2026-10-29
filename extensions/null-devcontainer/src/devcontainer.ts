// Pure helpers: no vscode import, covered by devcontainer.test.ts.
import * as crypto from 'crypto';

export const AUTHORITY_PREFIX = 'dev-container';
/** Port the server listens on inside the container; docker publishes it on a random 127.0.0.1 port. */
export const SERVER_PORT = 33000;

export interface DevContainerConfig {
  image?: string;
  initializeCommand?: string | string[];
  runArgs?: string[];
  remoteUser?: string;
  containerEnv?: Record<string, string>;
  workspaceFolder?: string;
  customizations?: { vscode?: { extensions?: string[] } };
}

export interface Vars {
  localWorkspaceFolder: string;
  containerWorkspaceFolder: string;
  env: NodeJS.ProcessEnv;
}

/** JSONC → JSON: drops comments and trailing commas, leaves strings alone. */
export function parseConfig(text: string): DevContainerConfig {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') { j++; } j++; }
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { i++; }
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '') + c;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

export function substitute(s: string, v: Vars): string {
  return s.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (m, name: string, arg?: string) => {
    switch (name) {
      case 'localWorkspaceFolder': return v.localWorkspaceFolder;
      case 'localWorkspaceFolderBasename': return basename(v.localWorkspaceFolder);
      case 'containerWorkspaceFolder': return v.containerWorkspaceFolder;
      case 'localEnv': return v.env[arg ?? ''] ?? '';
      default: return m; // unknown variables pass through untouched
    }
  });
}

/** Forward slashes everywhere: `sh` (Git Bash) and docker both accept them, backslashes break `sh -c`. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function basename(p: string): string {
  return normalizePath(p).replace(/\/+$/, '').split('/').pop() ?? '';
}

export function containerFolder(cfg: DevContainerConfig, local: string): string {
  return cfg.workspaceFolder?.replace('${localWorkspaceFolderBasename}', basename(local)) ?? `/workspaces/${basename(local)}`;
}

export function toAuthority(local: string): string {
  return `${AUTHORITY_PREFIX}+${Buffer.from(local, 'utf8').toString('hex')}`;
}

export function fromAuthority(authority: string): string {
  return Buffer.from(authority.slice(authority.indexOf('+') + 1), 'hex').toString('utf8');
}

export function containerName(local: string): string {
  return `null-dc-${crypto.createHash('sha1').update(local).digest('hex').slice(0, 12)}`;
}

/**
 * `docker run` arguments. The image's own entrypoint is replaced by a sleep loop (the dev containers
 * default, `overrideCommand`), so the container stays up for `docker exec`.
 */
export function buildRunArgs(cfg: DevContainerConfig, v: Vars, name: string): string[] {
  const env = Object.entries(cfg.containerEnv ?? {}).flatMap(([k, val]) => ['-e', `${k}=${substitute(val, v)}`]);
  return [
    'run', '-d', '--name', name,
    '--mount', `type=bind,source=${v.localWorkspaceFolder},target=${v.containerWorkspaceFolder}`,
    '-p', `127.0.0.1::${SERVER_PORT}`,
    ...env,
    ...(cfg.runArgs ?? []).map((a) => substitute(a, v)),
    '--entrypoint', 'sh', cfg.image!, '-c', 'while sleep 1000; do :; done',
  ];
}

/** Maps `uname -m` to the arch name used in the server download URL. */
export function archOf(uname: string): string {
  return /aarch64|arm64/.test(uname) ? 'arm64' : 'x64';
}
