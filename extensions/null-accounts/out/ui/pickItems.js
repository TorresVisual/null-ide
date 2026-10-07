'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNBIND_LABEL = exports.ADD_GITHUB_LABEL = void 0;
exports.buildPickItems = buildPickItems;
exports.ADD_GITHUB_LABEL = '$(add) Add GitHub account…';
exports.UNBIND_LABEL = '$(circle-slash) Use no account for this project';
/** Current account first, then the suggested one, then the rest in stored order; add; and "no account" when bound. */
function buildPickItems(accounts, { suggestedId, currentId } = {}) {
    const rank = (id) => (id === currentId ? 0 : id === suggestedId ? 1 : 2);
    const items = [...accounts]
        .sort((a, b) => rank(a.id) - rank(b.id)) // stable: ties keep their stored order
        .map((account) => ({
        label: `$(account) ${account.username}`,
        description: account.host,
        detail: account.id === currentId
            ? 'Current'
            : account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
        action: { kind: 'account', account },
    }));
    items.push({ label: exports.ADD_GITHUB_LABEL, action: { kind: 'add' } });
    if (currentId !== undefined && accounts.some(a => a.id === currentId)) {
        items.push({ label: exports.UNBIND_LABEL, action: { kind: 'unbind' } });
    }
    return items;
}
//# sourceMappingURL=pickItems.js.map