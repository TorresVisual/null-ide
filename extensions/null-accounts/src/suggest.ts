'use strict';

import { Account } from './types';

export interface RemoteRef {
  /** Lowercase hostname; includes the port for https remotes (matches `Account.host`). */
  host: string;
  owner: string;
  /** Login embedded in an https URL, never the ssh `git` user or a password. */
  user?: string;
}

const URL_RE = /^(https|ssh|git):\/\/(?:([^@/\s]+)@)?([^/:\s@]+)(:\d+)?\/([^/\s]+)\/\S+$/i;
// Host needs 2+ characters so a Windows drive path like "C:/repos/app" is not read as host "C".
const SCP_RE = /^(?:[^@/\s]+@)?([^:/\s]{2,}):([^/\s]+)\/\S+$/;

export function parseRemoteUrl(raw: string): RemoteRef | undefined {
  const url = raw.trim();
  const m = URL_RE.exec(url);
  if (m) {
    const [, scheme, login, host, port, owner] = m;
    const https = scheme.toLowerCase() === 'https';
    const ref: RemoteRef = { host: host.toLowerCase() + (https && port ? port : ''), owner };
    if (https && login) { ref.user = login.split(':')[0]; }
    return ref;
  }
  const s = SCP_RE.exec(url);
  return s ? { host: s[1].toLowerCase(), owner: s[2] } : undefined;
}

/** The account that best matches a repo's origin URL, or undefined. Only a suggestion: the user confirms it. */
export function suggestAccount(originUrl: string, accounts: readonly Account[]): Account | undefined {
  const remote = parseRemoteUrl(originUrl);
  if (!remote) { return undefined; }
  const onHost = accounts.filter(a => a.host === remote.host);
  const named = (name?: string): Account | undefined =>
    name ? onHost.find(a => a.username.toLowerCase() === name.toLowerCase()) : undefined;
  return named(remote.user) ?? named(remote.owner) ?? (onHost.length === 1 ? onHost[0] : undefined);
}
