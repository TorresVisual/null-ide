'use strict';

/** The slice of a null-accounts Account that a dashboard card shows. */
export interface AccountSummary { username: string; host: string }

/** "alice@github.com": the identity git and the Accounts panel show; one rule, no special cases. */
export function accountLabel(account: AccountSummary): string {
  return `${account.username}@${account.host}`;
}

/**
 * Adds `account` (a display label) to each project whose folder is bound to one. A `.code-workspace`
 * entry is a file, not a folder, so it never has a binding.
 */
export function withAccounts<T extends { path: string; isWorkspaceFile: boolean }>(
  projects: readonly T[],
  accountFor: (folderPath: string) => AccountSummary | undefined,
): Array<T & { account?: string }> {
  return projects.map(project => {
    const account = project.isWorkspaceFile ? undefined : accountFor(project.path);
    return account ? { ...project, account: accountLabel(account) } : project;
  });
}
