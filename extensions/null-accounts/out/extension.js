'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const accountStore_1 = require("./accountStore");
const api_1 = require("./api");
function activate(context) {
    const store = new accountStore_1.AccountStore(context.globalState, context.secrets);
    // Phase 2 swaps the resolver for projectBinding and registers the github token provider;
    // Phase 4 adds gitlab. Until then no folder is bound and no provider can issue tokens.
    return (0, api_1.createApi)({
        accounts: store,
        accountIdForFolder: () => undefined,
        tokenProviders: {},
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map