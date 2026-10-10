'use strict';

import { GitRun } from './git';
import { Account } from './types';

/**
 * Writes the account's name and email to the user's global git config (the Accounts panel button; nothing else
 * touches global config). Returns the message to show, naming the identity it replaced.
 */
export async function applyGlobalIdentity(git: GitRun, account: Account, cwd: string): Promise<string> {
  const get = async (key: string): Promise<string> => (await git(cwd, ['config', '--global', '--get', key])).stdout.trim();
  const [oldName, oldEmail] = [await get('user.name'), await get('user.email')];
  for (const [key, value] of [['user.name', account.username], ['user.email', account.email]]) {
    const result = await git(cwd, ['config', '--global', key, value]);
    if (result.code !== 0) { throw new Error(`git config --global ${key} failed: ${result.stderr.trim() || 'is git installed?'}`); }
  }
  const was = oldName || oldEmail ? ` (was ${oldName} <${oldEmail}>)` : '';
  return `Global git identity is now ${account.username} <${account.email}>${was}.`;
}
