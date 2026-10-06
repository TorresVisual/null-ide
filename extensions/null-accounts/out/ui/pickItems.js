'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADD_GITHUB_LABEL = void 0;
exports.buildPickItems = buildPickItems;
exports.ADD_GITHUB_LABEL = '$(add) Add GitHub account…';
/** Accounts (the suggested one first), then the add action. */
function buildPickItems(accounts, suggestedId) {
    const items = accounts.map(account => ({
        label: `$(account) ${account.username}`,
        description: account.host,
        detail: account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
        account,
    }));
    const rank = (i) => (i.account?.id === suggestedId ? 0 : 1);
    items.sort((a, b) => rank(a) - rank(b)); // stable: everything else keeps its order
    return [...items, { label: exports.ADD_GITHUB_LABEL }];
}
//# sourceMappingURL=pickItems.js.map