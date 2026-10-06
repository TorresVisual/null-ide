'use strict';

import { Account } from '../types';

export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  /** Absent on the "add" action. */
  account?: Account;
}

export const ADD_GITHUB_LABEL = '$(add) Add GitHub account…';

/** Accounts (the suggested one first), then the add action. */
export function buildPickItems(accounts: readonly Account[], suggestedId?: string): PickItem[] {
  const items: PickItem[] = accounts.map(account => ({
    label: `$(account) ${account.username}`,
    description: account.host,
    detail: account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
    account,
  }));
  const rank = (i: PickItem): number => (i.account?.id === suggestedId ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b)); // stable: everything else keeps its order
  return [...items, { label: ADD_GITHUB_LABEL }];
}
