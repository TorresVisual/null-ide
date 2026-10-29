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

/**
 * null-accounts writes the host's key paths into the repo's `.git/config`, which the container shares through
 * the bind mount. Those paths don't exist in the container, so `GIT_CONFIG_*` (command scope, beats the repo
 * config) points `core.sshCommand` / `user.signingkey` at the copied keys instead. Needs git >= 2.31.
 */
export function gitKeyOverrides(
  hostKeyDir: string, containerKeyDir: string, cfg: { sshCommand?: string; signingKey?: string },
): Record<string, string> {
  const host = normalizePath(hostKeyDir).toLowerCase();
  const swap = (v?: string) => {
    const r = v && swapAll(v, host, containerKeyDir);
    return r && r !== v ? r : undefined;
  };
  const ssh = swap(cfg.sshCommand);
  const key = swap(cfg.signingKey);
  const entries: [string, string][] = [];
  // accept-new: the container has no known_hosts, and git over ssh can't answer the prompt
  if (ssh) { entries.push(['core.sshCommand', `${ssh} -o StrictHostKeyChecking=accept-new`]); }
  if (key) { entries.push(['user.signingkey', key]); }
  if (!entries.length) { return {}; }
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  return env;
}

/** Case-insensitive literal replace of every `fromLower` in `v`. */
function swapAll(v: string, fromLower: string, to: string): string {
  let out = '';
  let i = 0;
  for (let j = v.toLowerCase().indexOf(fromLower); j >= 0; j = v.toLowerCase().indexOf(fromLower, i)) {
    out += v.slice(i, j) + to;
    i = j + fromLower.length;
  }
  return out + v.slice(i);
}

/** `export K='V'` lines for a POSIX shell to source. */
export function envFile(env: Record<string, string>): string {
  const q = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  return Object.entries(env).map(([k, v]) => 'export ' + k + '=' + q(v) + '\n').join('');
}

/** Maps `uname -m` to the arch name used in the server download URL. */
export function archOf(uname: string): string {
  return /aarch64|arm64/.test(uname) ? 'arm64' : 'x64';
}
