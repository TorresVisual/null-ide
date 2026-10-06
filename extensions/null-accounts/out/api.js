'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApi = createApi;
function createApi(deps) {
    const getAccountForFolder = (folder) => {
        const id = deps.accountIdForFolder(folder);
        return id === undefined ? undefined : deps.accounts.get(id);
    };
    return {
        getAccounts: () => deps.accounts.list(),
        getAccountForFolder,
        async ensureAccountForFolder(folder) {
            const bound = getAccountForFolder(folder);
            if (bound) {
                return bound;
            }
            try {
                return await deps.chooseAccountForFolder(folder);
            }
            catch {
                return undefined;
            }
        },
        async getToken(account, scopes, options) {
            // Callers pass an Account they got from this API; trust only the stored copy, never its fields.
            const stored = deps.accounts.get(account.id);
            if (!stored) {
                return undefined;
            }
            try {
                return await deps.tokenProviders[stored.provider]?.getToken(stored, scopes, options);
            }
            catch {
                return undefined;
            }
        },
        onDidChange: deps.onDidChange,
    };
}
//# sourceMappingURL=api.js.map