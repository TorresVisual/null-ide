'use strict';

import { Account } from '../types';

export function statusBarModel(folderName: string, account: Account | undefined): { text: string; tooltip: string } {
  return account
    ? { text: `$(account) ${account.username}`, tooltip: `${folderName} uses ${account.username}@${account.host} — click to switch` }
    : { text: '$(account) No account', tooltip: `${folderName} has no account — click to choose one` };
}
