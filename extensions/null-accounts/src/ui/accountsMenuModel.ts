'use strict';

import { Account, Provider } from '../types';

/** Contract with the workbench patch (007): it renders whatever array is under this key. */
export type NullAccountsMenuEntry =
  | 'separator'
  | {
    label: string;
    /** The account's host; the workbench draws it dimmed after the label. Its presence marks an account row. */
    description?: string;
    /** `data:image/...;base64,...` profile picture. */
    avatar?: string;
    /** Shown as the glyph when there is no picture. */
    provider?: Provider;
    /** Codicon name in front of the label: `add` or `gear`. */
    icon?: 'add' | 'gear';
    /** `false` makes a non-clickable heading row. */
    enabled?: boolean;
    checked?: boolean;
    command: string;
    args?: unknown[];
  };

export const MENU_CONTEXT_KEY = 'null.accounts.menu';
/** The picture the activity bar's Accounts button shows (a `data:` URI, or '' for none). Read by patch 007. */
export const AVATAR_CONTEXT_KEY = 'null.accounts.avatar';
export const BIND_COMMAND = 'null-accounts.bindFolderToAccount';
export const ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
export const MANAGE_COMMAND = 'null-accounts.open';

/** The Accounts menu: a "Project: <folder>" heading, one row per account (current one checked), then Add / Manage. */
export function accountsMenuModel(
  accounts: readonly Account[],
  currentAccountId?: string,
  avatarOf: (id: string) => string | undefined = () => undefined,
  folderName?: string,
): NullAccountsMenuEntry[] {
  const rows: NullAccountsMenuEntry[] = accounts.map(a => ({
    label: a.username,
    description: a.host,
    provider: a.provider,
    ...(avatarOf(a.id) ? { avatar: avatarOf(a.id) } : {}),
    checked: a.id === currentAccountId,
    command: BIND_COMMAND,
    args: [a.id],
  }));
  if (rows.length) {
    // Never runs (disabled); the contract wants a command on every row.
    if (folderName) { rows.unshift({ label: `Project: ${folderName}`, enabled: false, command: MANAGE_COMMAND }); }
    rows.push('separator');
  }
  rows.push(
    { label: 'Add Account…', icon: 'add', command: ADD_ACCOUNT_COMMAND },
    { label: 'Manage Accounts…', icon: 'gear', command: MANAGE_COMMAND },
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
