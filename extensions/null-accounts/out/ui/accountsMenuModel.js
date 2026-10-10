'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGE_COMMAND = exports.ADD_ACCOUNT_COMMAND = exports.BIND_COMMAND = exports.AVATAR_CONTEXT_KEY = exports.MENU_CONTEXT_KEY = void 0;
exports.accountsMenuModel = accountsMenuModel;
exports.activityAvatar = activityAvatar;
exports.MENU_CONTEXT_KEY = 'null.accounts.menu';
/** The picture the activity bar's Accounts button shows (a `data:` URI, or '' for none). Read by patch 007. */
exports.AVATAR_CONTEXT_KEY = 'null.accounts.avatar';
exports.BIND_COMMAND = 'null-accounts.bindFolderToAccount';
exports.ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
exports.MANAGE_COMMAND = 'null-accounts.open';
/** The Accounts menu: one row per account (current one checked), then Add / Manage. */
function accountsMenuModel(accounts, currentAccountId, avatarOf = () => undefined) {
    const rows = accounts.map(a => ({
        label: a.username,
        description: a.host,
        ...(avatarOf(a.id) ? { avatar: avatarOf(a.id) } : {}),
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
/** The open folder's account picture, else the first account that has one, else ''. */
function activityAvatar(accounts, currentAccountId, avatarOf) {
    return (currentAccountId && avatarOf(currentAccountId)) || accounts.map(a => avatarOf(a.id)).find(Boolean) || '';
}
//# sourceMappingURL=accountsMenuModel.js.map