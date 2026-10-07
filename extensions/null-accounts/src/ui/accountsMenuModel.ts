'use strict';

import { Account } from '../types';

/** Contract with the workbench patch (007): it renders whatever array is under this key. */
export type NullAccountsMenuEntry =
  | 'separator'
  | { label: string; description?: string; checked?: boolean; command: string; args?: unknown[] };

export const MENU_CONTEXT_KEY = 'null.accounts.menu';
export const BIND_COMMAND = 'null-accounts.bindFolderToAccount';
export const ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
export const MANAGE_COMMAND = 'null-accounts.open';

/** The Accounts menu: one row per account (current one checked), then Add / Manage. */
export function accountsMenuModel(accounts: readonly Account[], currentAccountId?: string): NullAccountsMenuEntry[] {
  const rows: NullAccountsMenuEntry[] = accounts.map(a => ({
    label: a.username,
    description: a.host,
    checked: a.id === currentAccountId,
    command: BIND_COMMAND,
    args: [a.id],
  }));
  if (rows.length) { rows.push('separator'); }
  rows.push(
    { label: 'Add Account…', command: ADD_ACCOUNT_COMMAND },
    { label: 'Manage Accounts…', command: MANAGE_COMMAND },
  );
  return rows;
}
