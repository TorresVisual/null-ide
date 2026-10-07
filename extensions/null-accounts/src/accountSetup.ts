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

/** GitLab sign-in: add the account with its tokens, or (already stored) replace the tokens — how an expired sign-in is repaired. */
export async function addOrRefresh(
  accounts: Accounts & {
    setSecret(id: string, value: string): Promise<void>;
    update(id: string, patch: Partial<NewAccount>): Promise<Account>;
  },
  candidate: NewAccount,
  secret: string,
): Promise<Account> {
  const existing = findAccount(accounts.list(), candidate);
  if (!existing) { return accounts.add(candidate, secret); }
  // The secret's format follows the sign-in method (OAuth tokens vs a raw access token), so the two change together.
  const account = existing.authMethod === candidate.authMethod
    ? existing
    : await accounts.update(existing.id, { authMethod: candidate.authMethod });
  await accounts.setSecret(existing.id, secret);
  return account;
}
