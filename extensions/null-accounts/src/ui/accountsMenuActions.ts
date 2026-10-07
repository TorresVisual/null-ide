'use strict';

import { Account } from '../types';
import { MENU_CONTEXT_KEY, NullAccountsMenuEntry } from './accountsMenuModel';

export type BindResult = 'bound' | 'no-folder' | 'no-account';

export interface BindDeps {
  /** First workspace folder's fsPath; undefined when no folder is open. */
  folderPath: string | undefined;
  accounts: { get(id: string): Account | undefined };
  bindings: { bind(folderPath: string, accountId: string): Promise<void> };
}

/** The menu's click target. Re-reads the store, so a row for an account removed since the menu opened is a no-op. */
export async function bindFolderToAccount(deps: BindDeps, accountId: unknown): Promise<BindResult> {
  if (deps.folderPath === undefined) { return 'no-folder'; }
  if (typeof accountId !== 'string' || !deps.accounts.get(accountId)) { return 'no-account'; }
  await deps.bindings.bind(deps.folderPath, accountId);
  return 'bound';
}

/** Publishes the menu; a failure leaves the previous key value in place and must never break activation or a listener. */
export async function publishAccountsMenu(
  compute: () => NullAccountsMenuEntry[],
  setContext: (key: string, value: unknown) => PromiseLike<unknown>,
): Promise<void> {
  try {
    await setContext(MENU_CONTEXT_KEY, compute());
  } catch { /* keep the previous value */ }
}
