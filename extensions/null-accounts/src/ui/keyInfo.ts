'use strict';

import { sshKeyFile } from '../gitPlan';
import { isManagedKey } from '../sshKey';
import { Account } from '../types';

/** What the panel shows about an account's key. */
export interface KeyRow {
  /** As stored on the account. */
  path: string;
  exists: boolean;
  /** Created by Null IDE (inside ~/.ssh/null-accounts): the only keys the panel can delete. */
  managed: boolean;
  fingerprint?: string;
  signCommits: boolean;
  /** An SSH-only account cannot lose its key. */
  removable: boolean;
}

export interface KeyInfoDeps {
  home: string;
  exists(file: string): boolean;
  fingerprintOf(keyFile: string): Promise<string | undefined>;
}

/** One row per account that has a key. Never rejects: an unreadable key just has no fingerprint. */
export async function describeKeys(accounts: readonly Account[], deps: KeyInfoDeps): Promise<Map<string, KeyRow>> {
  const rows = new Map<string, KeyRow>();
  await Promise.all(accounts.filter(a => a.sshKeyPath).map(async account => {
    const keyFile = sshKeyFile(account, deps.home);
    const exists = deps.exists(keyFile);
    const fingerprint = exists ? await deps.fingerprintOf(keyFile).catch(() => undefined) : undefined;
    rows.set(account.id, {
      path: account.sshKeyPath!,
      exists,
      managed: isManagedKey(keyFile, deps.home),
      ...(fingerprint ? { fingerprint } : {}),
      signCommits: account.signCommits === true,
      removable: account.authMethod !== 'ssh',
    });
  }));
  // Promise.all settles in completion order; keep the accounts' own order.
  return new Map(accounts.filter(a => rows.has(a.id)).map(a => [a.id, rows.get(a.id)!]));
}
