'use strict';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sshKeyFile } from './gitPlan';
import { managedKeyDir } from './sshKey';
import { Account } from './types';

// Plain `git clone` (terminal, other tools) has no repo yet, so repo-local `core.sshCommand` can't apply.
// Instead the keys live in a file Null IDE owns, pulled into the user's ssh config by one `Include` line.
// Relative Include paths in a user config resolve against ~/.ssh, so this works for every OpenSSH on Windows.
const INCLUDE_COMMENT = '# Null IDE account keys (managed; removed when no account has a key)';
const INCLUDE_LINE = 'Include null-accounts/config';

const managedConfigFile = (home: string): string => path.join(managedKeyDir(home), 'config');

/**
 * One `Host` block per hostname, listing the key of every account on it that has one.
 * ponytail: with two accounts on one host ssh tries the keys in order and the server takes the first it knows;
 * a bound repo still gets its own account's key from `core.sshCommand`. Per-account host aliases if that bites.
 */
export function renderHostBlocks(accounts: Account[], home: string): string {
  const keysByHost = new Map<string, Set<string>>();
  for (const account of accounts) {
    const host = account.host.replace(/:\d+$/, ''); // ssh matches the hostname; the port comes from the URL
    const key = sshKeyFile(account, home);
    // Anything outside these sets could end the value or add a directive of its own.
    if (!key || /["\r\n]/.test(key) || !/^[a-z0-9.-]+$/.test(host)) { continue; }
    (keysByHost.get(host) ?? keysByHost.set(host, new Set()).get(host)!).add(key);
  }
  return [...keysByHost]
    .map(([host, keys]) => [
      `Host ${host}`,
      ...[...keys].map(key => `  IdentityFile "${key}"`),
      '  IdentitiesOnly yes',
      '',
    ].join('\n'))
    .join('\n');
}

const hasInclude = (config: string): boolean => config.split(/\r?\n/).some(l => l.trim() === INCLUDE_LINE);

/** The Include must come before any `Host`/`Match` line, or it would only apply inside that block. */
export function withInclude(config: string): string {
  if (hasInclude(config)) { return config; }
  const eol = config.includes('\r\n') ? '\r\n' : '\n';
  return `${INCLUDE_COMMENT}${eol}${INCLUDE_LINE}${eol}${config.length > 0 ? eol : ''}${config}`;
}

export function withoutInclude(config: string): string {
  const eol = config.includes('\r\n') ? '\r\n' : '\n';
  const lines = config.split(/\r?\n/);
  const at = lines.findIndex(l => l.trim() === INCLUDE_LINE);
  if (at < 0) { return config; }
  const start = lines[at - 1]?.trim() === INCLUDE_COMMENT ? at - 1 : at;
  const end = lines[at + 1]?.trim() === '' ? at + 2 : at + 1; // the blank line withInclude added
  lines.splice(start, end - start);
  return lines.join(eol);
}

const readIfExists = (file: string): Promise<string | undefined> =>
  fs.readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') { return undefined; }
    throw err;
  });

/** Brings `~/.ssh/null-accounts/config` and the Include line in `~/.ssh/config` in line with the accounts. Writes only on change. */
export async function syncSshConfig(accounts: Account[], home: string): Promise<void> {
  const managedFile = managedConfigFile(home);
  const userFile = path.join(home, '.ssh', 'config');
  const block = renderHostBlocks(accounts, home);
  const user = await readIfExists(userFile);

  if (block) {
    await fs.mkdir(path.dirname(managedFile), { recursive: true });
    if ((await readIfExists(managedFile)) !== block) { await fs.writeFile(managedFile, block); }
    if (user === undefined || !hasInclude(user)) { await fs.writeFile(userFile, withInclude(user ?? '')); }
  } else {
    await fs.rm(managedFile, { force: true });
    if (user !== undefined && hasInclude(user)) { await fs.writeFile(userFile, withoutInclude(user)); }
  }
}
