'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApi = createApi;
function createApi(deps) {
    return {
        getAccounts: () => deps.accounts.list(),
        getAccountForFolder(folder) {
            const id = deps.accountIdForFolder(folder);
            return id === undefined ? undefined : deps.accounts.get(id);
        },
        async getToken(account, scopes) {
            try {
                return await deps.tokenProviders[account.provider]?.getToken(account, scopes);
            }
            catch {
                return undefined;
            }
        },
        onDidChange: deps.accounts.onDidChange,
    };
}
//# sourceMappingURL=api.js.map