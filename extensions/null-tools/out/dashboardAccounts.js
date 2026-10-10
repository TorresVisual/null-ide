'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountLabel = accountLabel;
exports.withAccounts = withAccounts;
/** "alice@github.com": the identity git and the Accounts panel show; one rule, no special cases. */
function accountLabel(account) {
    return `${account.username}@${account.host}`;
}
/**
 * Adds `account` (a display label) to each project whose folder is bound to one. A `.code-workspace`
 * entry is a file, not a folder, so it never has a binding.
 */
function withAccounts(projects, accountFor) {
    return projects.map(project => {
        const account = project.isWorkspaceFile ? undefined : accountFor(project.path);
        return account ? { ...project, account: accountLabel(account) } : project;
    });
}
//# sourceMappingURL=dashboardAccounts.js.map