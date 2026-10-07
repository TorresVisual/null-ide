'use strict';

import { Account } from '../types';

export type PickAction =
  | { kind: 'account'; account: Account }
  | { kind: 'add' }
  | { kind: 'unbind' };

export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  action: PickAction;
}

export interface PickOptions {
  /** Matches the repository's origin remote (only worth computing for an unbound folder). */
  suggestedId?: string;
  /** The account the folder is bound to now. */
  currentId?: string;
}

export const ADD_ACCOUNT_LABEL = '$(add) Add account…';
export const UNBIND_LABEL = '$(circle-slash) Use no account for this project';

/** Current account first, then the suggested one, then the rest in stored order; add; and "no account" when bound. */
export function buildPickItems(accounts: readonly Account[], { suggestedId, currentId }: PickOptions = {}): PickItem[] {
  const rank = (id: string): number => (id === currentId ? 0 : id === suggestedId ? 1 : 2);
  const items = [...accounts]
    .sort((a, b) => rank(a.id) - rank(b.id)) // stable: ties keep their stored order
    .map((account): PickItem => ({
      label: `$(account) ${account.username}`,
      description: account.host,
      detail: account.id === currentId
        ? 'Current'
        : account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
      action: { kind: 'account', account },
    }));
  items.push({ label: ADD_ACCOUNT_LABEL, action: { kind: 'add' } });
  if (currentId !== undefined && accounts.some(a => a.id === currentId)) {
    items.push({ label: UNBIND_LABEL, action: { kind: 'unbind' } });
  }
  return items;
}

export type ProviderChoice = 'github' | 'gitlab' | 'gitlab-self-hosted' | 'gitlab-token';

/** The second quick-pick, shown after "Add account…". */
export const providerPickItems = (): Array<{ label: string; description: string; choice: ProviderChoice }> => [
  { label: 'GitHub', description: 'github.com', choice: 'github' },
  { label: 'GitLab', description: 'gitlab.com', choice: 'gitlab' },
  { label: 'GitLab self-hosted…', description: 'your own server (https)', choice: 'gitlab-self-hosted' },
  { label: 'GitLab with an access token…', description: 'for servers that don’t allow OAuth apps', choice: 'gitlab-token' },
];
