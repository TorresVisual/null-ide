'use strict';

import { Account } from '../types';

/** Contract with the workbench patch (007): it renders whatever array is under this key. */
export type NullAccountsMenuEntry =
  | 'separator'
  | { label: string; description?: string; /** `data:image/...;base64,...` profile picture. */ avatar?: string; checked?: boolean; command: string; args?: unknown[] };

export const MENU_CONTEXT_KEY = 'null.accounts.menu';
/** The picture the activity bar's Accounts button shows (a `data:` URI, or '' for none). Read by patch 007. */
export const AVATAR_CONTEXT_KEY = 'null.accounts.avatar';
export const BIND_COMMAND = 'null-accounts.bindFolderToAccount';
export const ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
export const MANAGE_COMMAND = 'null-accounts.open';

/** The Accounts menu: one row per account (current one checked), then Add / Manage. */
export function accountsMenuModel(
  accounts: readonly Account[],
  currentAccountId?: string,
  avatarOf: (id: string) => string | undefined = () => undefined,
): NullAccountsMenuEntry[] {
  const rows: NullAccountsMenuEntry[] = accounts.map(a => ({
    label: a.username,
    description: a.host,
    ...(avatarOf(a.id) ? { avatar: avatarOf(a.id) } : {}),
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

/** The open folder's account picture, else the first account that has one, else ''. */
export function activityAvatar(
  accounts: readonly Account[],
  currentAccountId: string | undefined,
  avatarOf: (id: string) => string | undefined,
): string {
  return (currentAccountId && avatarOf(currentAccountId)) || accounts.map(a => avatarOf(a.id)).find(Boolean) || '';
}
