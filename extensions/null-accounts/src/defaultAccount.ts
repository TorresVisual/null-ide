'use strict';

import { ProjectBinding } from './projectBinding';
import { suggestAccount } from './suggest';
import { Account } from './types';

export interface DefaultAccountDeps {
  bindings: ProjectBinding;
  accounts: { list(): Account[]; get(id: string): Account | undefined };
  /** The folder's `origin` remote URL, if it has one. */
  originUrl(folder: string): Promise<string | undefined>;
}

/**
 * Gives each folder that has never had an account its first one: the account matching its origin remote,
 * else the default. Folders that already have a binding keep it. Does nothing while no default is set.
 */
export async function applyDefaultAccount(deps: DefaultAccountDeps, folders: readonly string[]): Promise<void> {
  const defaultId = deps.bindings.defaultId();
  if (defaultId === undefined || !deps.accounts.get(defaultId)) { return; }
  for (const folder of folders) {
    if (deps.bindings.wasAdopted(folder)) { continue; }
    // A folder that is bound already doesn't need its remote looked up.
    const origin = deps.bindings.accountIdFor(folder) === undefined ? await deps.originUrl(folder) : undefined;
    const suggested = origin ? suggestAccount(origin, deps.accounts.list())?.id : undefined;
    await deps.bindings.adoptFolder(folder, suggested ?? defaultId);
  }
}
