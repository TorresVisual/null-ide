'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDefaultAccount = applyDefaultAccount;
const suggest_1 = require("./suggest");
/**
 * Gives each folder that has never had an account its first one: the account matching its origin remote,
 * else the default. Folders that already have a binding keep it. Does nothing while no default is set.
 */
async function applyDefaultAccount(deps, folders) {
    const defaultId = deps.bindings.defaultId();
    if (defaultId === undefined || !deps.accounts.get(defaultId)) {
        return;
    }
    for (const folder of folders) {
        if (deps.bindings.wasAdopted(folder)) {
            continue;
        }
        // A folder that is bound already doesn't need its remote looked up.
        const origin = deps.bindings.accountIdFor(folder) === undefined ? await deps.originUrl(folder) : undefined;
        const suggested = origin ? (0, suggest_1.suggestAccount)(origin, deps.accounts.list())?.id : undefined;
        await deps.bindings.adoptFolder(folder, suggested ?? defaultId);
    }
}
//# sourceMappingURL=defaultAccount.js.map