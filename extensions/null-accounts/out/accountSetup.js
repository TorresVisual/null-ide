'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAccount = findAccount;
exports.addOrReuse = addOrReuse;
exports.importExisting = importExisting;
exports.addOrRefresh = addOrRefresh;
const accountStore_1 = require("./accountStore");
function findAccount(accounts, candidate) {
    return accounts.find(a => (0, accountStore_1.sameIdentity)(a, candidate));
}
/** Signing in again as an account that's already stored must resolve to it, not fail as a duplicate. */
async function addOrReuse(accounts, candidate) {
    return findAccount(accounts.list(), candidate) ?? accounts.add(candidate);
}
/**
 * First-run migration: store the account VS Code was already signed in with and bind every open,
 * unbound folder to it, so an existing user's Issues panel keeps working.
 */
async function importExisting(found, folders, accounts, bindings) {
    const account = await addOrReuse(accounts, found);
    for (const folder of folders) {
        if (bindings.accountIdFor(folder) === undefined) {
            await bindings.bind(folder, account.id);
        }
    }
    return account;
}
/** GitLab sign-in: add the account with its tokens, or (already stored) replace the tokens — how an expired sign-in is repaired. */
async function addOrRefresh(accounts, candidate, secret) {
    const existing = findAccount(accounts.list(), candidate);
    if (!existing) {
        return accounts.add(candidate, secret);
    }
    await accounts.setSecret(existing.id, secret);
    return existing;
}
//# sourceMappingURL=accountSetup.js.map