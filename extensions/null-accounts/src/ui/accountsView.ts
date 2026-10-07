'use strict';

import path from 'node:path';
import { Account } from '../types';

export interface ProjectRef {
  /** `folderKey` form; what the panel sends back to unbind. */
  key: string;
  /** Real-cased path when the folder exists, else the key. */
  path: string;
  name: string;
  exists: boolean;
}

export interface AccountRow {
  id: string;
  provider: Account['provider'];
  host: string;
  username: string;
  email: string;
  authMethod: Account['authMethod'];
  /** The sign-in has expired and cannot be refreshed; the panel offers Re-authenticate. */
  needsReauth: boolean;
  projects: ProjectRef[];
}

export type ResolveFolder = (key: string) => { path: string; exists: boolean };

/** Everything the panel shows, as plain data. Deliberately copies display fields only. */
export function buildRows(
  accounts: readonly Account[],
  entries: ReadonlyArray<readonly [string, string]>,
  resolve: ResolveFolder,
  needsReauth: (id: string) => boolean = () => false,
): AccountRow[] {
  return accounts.map(a => ({
    id: a.id,
    provider: a.provider,
    host: a.host,
    username: a.username,
    email: a.email,
    authMethod: a.authMethod,
    needsReauth: needsReauth(a.id),
    projects: entries
      .filter(([, accountId]) => accountId === a.id)
      .map(([key]): ProjectRef => {
        let resolved: { path: string; exists: boolean };
        try { resolved = resolve(key); } catch { resolved = { path: key, exists: false }; }
        return { key, path: resolved.path, name: path.basename(resolved.path) || resolved.path, exists: resolved.exists };
      })
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })),
  }));
}

export function removeConfirmation(
  account: Pick<Account, 'username' | 'host'>,
  projectCount: number,
): { message: string; detail: string } {
  const used = projectCount === 0
    ? ''
    : `${projectCount} project${projectCount === 1 ? '' : 's'} will lose their account binding. `;
  return {
    message: `Remove ${account.username}@${account.host}?`,
    detail: `${used}This only removes the account from Null IDE; any sign-in kept by VS Code is not affected.`,
  };
}
