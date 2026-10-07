'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountsMenuActions_1 = require("./accountsMenuActions");
const accountsMenuModel_1 = require("./accountsMenuModel");
const acct = (id) => ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });
function deps(folderPath, accounts) {
    const bound = [];
    return {
        bound,
        deps: {
            folderPath,
            accounts: { get: (id) => accounts.find(a => a.id === id) },
            bindings: { bind: async (folder, id) => { bound.push([folder, id]); } },
        },
    };
}
(0, node_test_1.test)('binds the first folder to an existing account', async () => {
    const d = deps('C:/work/repo', [acct('a1')]);
    node_assert_1.default.strictEqual(await (0, accountsMenuActions_1.bindFolderToAccount)(d.deps, 'a1'), 'bound');
    node_assert_1.default.deepStrictEqual(d.bound, [['C:/work/repo', 'a1']]);
});
(0, node_test_1.test)('no folder open: nothing is bound', async () => {
    const d = deps(undefined, [acct('a1')]);
    node_assert_1.default.strictEqual(await (0, accountsMenuActions_1.bindFolderToAccount)(d.deps, 'a1'), 'no-folder');
    node_assert_1.default.deepStrictEqual(d.bound, []);
});
(0, node_test_1.test)('stale click (account removed since the menu opened), missing or non-string id: nothing is bound', async () => {
    const d = deps('C:/work/repo', [acct('a1')]);
    for (const id of ['gone', undefined, 42, { id: 'a1' }]) {
        node_assert_1.default.strictEqual(await (0, accountsMenuActions_1.bindFolderToAccount)(d.deps, id), 'no-account');
    }
    node_assert_1.default.deepStrictEqual(d.bound, []);
});
(0, node_test_1.test)('publishes the model under the menu context key', async () => {
    const calls = [];
    const model = ['separator'];
    await (0, accountsMenuActions_1.publishAccountsMenu)(() => model, async (k, v) => { calls.push([k, v]); });
    node_assert_1.default.deepStrictEqual(calls, [[accountsMenuModel_1.MENU_CONTEXT_KEY, model]]);
});
(0, node_test_1.test)('a throwing model or a rejecting setContext never escapes', async () => {
    await (0, accountsMenuActions_1.publishAccountsMenu)(() => { throw new Error('boom'); }, async () => { node_assert_1.default.fail('must not publish'); });
    await (0, accountsMenuActions_1.publishAccountsMenu)(() => [], async () => { throw new Error('host gone'); });
});
//# sourceMappingURL=accountsMenuActions.test.js.map