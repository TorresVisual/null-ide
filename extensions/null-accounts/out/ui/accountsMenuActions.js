'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindFolderToAccount = bindFolderToAccount;
exports.publishAccountsMenu = publishAccountsMenu;
const accountsMenuModel_1 = require("./accountsMenuModel");
/** The menu's click target. Re-reads the store, so a row for an account removed since the menu opened is a no-op. */
async function bindFolderToAccount(deps, accountId) {
    if (deps.folderPath === undefined) {
        return 'no-folder';
    }
    if (typeof accountId !== 'string' || !deps.accounts.get(accountId)) {
        return 'no-account';
    }
    await deps.bindings.bind(deps.folderPath, accountId);
    return 'bound';
}
/** Publishes the menu; a failure leaves the previous key value in place and must never break activation or a listener. */
async function publishAccountsMenu(compute, setContext) {
    try {
        await setContext(accountsMenuModel_1.MENU_CONTEXT_KEY, compute());
    }
    catch { /* keep the previous value */ }
}
//# sourceMappingURL=accountsMenuActions.js.map