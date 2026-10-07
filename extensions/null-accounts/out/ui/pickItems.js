'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerPickItems = exports.UNBIND_LABEL = exports.ADD_ACCOUNT_LABEL = void 0;
exports.buildPickItems = buildPickItems;
exports.ADD_ACCOUNT_LABEL = '$(add) Add account…';
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
    items.push({ label: exports.ADD_ACCOUNT_LABEL, action: { kind: 'add' } });
    if (currentId !== undefined && accounts.some(a => a.id === currentId)) {
        items.push({ label: exports.UNBIND_LABEL, action: { kind: 'unbind' } });
    }
    return items;
}
/** The second quick-pick, shown after "Add account…". */
const providerPickItems = () => [
    { label: 'GitHub', description: 'github.com', choice: 'github' },
    { label: 'GitLab', description: 'gitlab.com', choice: 'gitlab' },
    { label: 'GitLab self-hosted…', description: 'your own server (https)', choice: 'gitlab-self-hosted' },
];
exports.providerPickItems = providerPickItems;
//# sourceMappingURL=pickItems.js.map