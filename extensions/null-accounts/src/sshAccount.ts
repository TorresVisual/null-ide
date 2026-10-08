'use strict';

import { normalizeHost, validateNewAccount } from './accountInput';
import { expandKeyPath } from './gitPlan';
import { NewAccount } from './types';

/** A bare lowercase host for an SSH account. No port: ssh takes it from the remote URL, and `suggest` matches on the bare host. */
export function normalizeSshHost(input: string): string {
  const host = normalizeHost(input);
  if (host.includes(':')) {
    throw new Error('Enter the host name without a port; SSH takes the port from the repository URL.');
  }
  return host;
}

/** Why this file can't be an account's key, or `undefined` if it can. */
export function checkKeyPath(keyPath: string, home: string, exists: (file: string) => boolean): string | undefined {
  const raw = keyPath.trim();
  if (!raw) { return 'Choose the private key file.'; }
  if (/\.pub$/i.test(raw)) {
    return 'That is the public key (.pub). Choose the private key next to it, the file without .pub.';
  }
  return exists(expandKeyPath(raw, home)) ? undefined : `There is no file at ${raw}.`;
}

export interface SshAccountInput { host: string; username: string; email: string; keyPath: string }

/** GitHub for github.com, GitLab for every other host. Throws an Error with a message fit to show the user. */
export function buildSshAccount(input: SshAccountInput, home: string, exists: (file: string) => boolean): NewAccount {
  const host = normalizeSshHost(input.host);
  const problem = checkKeyPath(input.keyPath, home, exists);
  if (problem) { throw new Error(problem); }
  return validateNewAccount({
    provider: host === 'github.com' ? 'github' : 'gitlab',
    host,
    username: input.username,
    email: input.email,
    authMethod: 'ssh',
    sshKeyPath: input.keyPath,
  });
}
