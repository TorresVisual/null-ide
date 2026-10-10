'use strict';

import { AuthMethod, NewAccount, Provider } from './types';

const PROVIDERS: readonly Provider[] = ['github', 'gitlab'];
const AUTH_METHODS: readonly AuthMethod[] = ['oauth', 'ssh', 'https'];

/** "https://GitLab.com/" -> "gitlab.com". Rejects http:// and anything that isn't a bare host[:port]. */
export function normalizeHost(input: string): string {
  let host = input.trim().toLowerCase();
  if (host.startsWith('http://')) {
    throw new Error('Plain http:// hosts are not supported; use https.');
  }
  if (host.startsWith('https://')) {
    host = host.slice('https://'.length);
  }
  host = host.replace(/\/+$/, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host)) {
    throw new Error(`Invalid host: "${input}"`);
  }
  return host;
}

/** Returns a trimmed, normalised copy of `input`; throws an Error describing the first problem. */
export function validateNewAccount(input: NewAccount): NewAccount {
  if (!PROVIDERS.includes(input.provider)) {
    throw new Error(`Unknown provider: ${String(input.provider)}`);
  }
  if (!AUTH_METHODS.includes(input.authMethod)) {
    throw new Error(`Unknown auth method: ${String(input.authMethod)}`);
  }
  const username = input.username.trim();
  if (!username) {
    throw new Error('Username is required.');
  }
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required.');
  }
  const out: NewAccount = {
    provider: input.provider,
    host: normalizeHost(input.host),
    username,
    email,
    authMethod: input.authMethod,
  };
  const gitName = input.gitName?.trim();
  if (gitName) {
    out.gitName = gitName;
  }
  const key = input.sshKeyPath?.trim();
  if (input.authMethod === 'ssh' && !key) {
    throw new Error('An SSH key path is required for SSH accounts.');
  }
  if (key) {
    out.sshKeyPath = key;
  }
  if (input.signCommits) {
    if (!key) {
      throw new Error('Commit signing needs an SSH key.');
    }
    out.signCommits = true;
  }
  const externalId = input.externalId?.trim();
  if (externalId) {
    out.externalId = externalId;
  }
  return out;
}
