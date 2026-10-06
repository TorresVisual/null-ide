'use strict';

import { sameIdentity } from './accountStore';
import { Account, NewAccount } from './types';

interface Accounts {
  list(): Account[];
  add(input: NewAccount, secret?: string): Promise<Account>;
}

interface Bindings {
  accountIdFor(folderPath: string): string | undefined;
  bind(folderPath: string, accountId: string): Promise<void>;
}

export function findAccount(accounts: readonly Account[], candidate: NewAccount): Account | undefined {
  return accounts.find(a => sameIdentity(a, candidate));
}

/** Signing in again as an account that's already stored must resolve to it, not fail as a duplicate. */
export async function addOrReuse(accounts: Accounts, candidate: NewAccount): Promise<Account> {
  return findAccount(accounts.list(), candidate) ?? accounts.add(candidate);
}

/**
 * First-run migration: store the account VS Code was already signed in with and bind every open,
 * unbound folder to it, so an existing user's Issues panel keeps working.
 */
export async function importExisting(
  found: NewAccount,
  folders: readonly string[],
  accounts: Accounts,
  bindings: Bindings,
): Promise<Account> {
  const account = await addOrReuse(accounts, found);
  for (const folder of folders) {
    if (bindings.accountIdFor(folder) === undefined) {
      await bindings.bind(folder, account.id);
    }
  }
  return account;
}
