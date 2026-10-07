'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGE_COMMAND = exports.ADD_ACCOUNT_COMMAND = exports.BIND_COMMAND = exports.MENU_CONTEXT_KEY = void 0;
exports.accountsMenuModel = accountsMenuModel;
exports.MENU_CONTEXT_KEY = 'null.accounts.menu';
exports.BIND_COMMAND = 'null-accounts.bindFolderToAccount';
exports.ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
exports.MANAGE_COMMAND = 'null-accounts.open';
/** The Accounts menu: one row per account (current one checked), then Add / Manage. */
function accountsMenuModel(accounts, currentAccountId) {
    const rows = accounts.map(a => ({
        label: a.username,
        description: a.host,
        checked: a.id === currentAccountId,
        command: exports.BIND_COMMAND,
        args: [a.id],
    }));
    if (rows.length) {
        rows.push('separator');
    }
    rows.push({ label: 'Add Account…', command: exports.ADD_ACCOUNT_COMMAND }, { label: 'Manage Accounts…', command: exports.MANAGE_COMMAND });
    return rows;
}
//# sourceMappingURL=accountsMenuModel.js.map