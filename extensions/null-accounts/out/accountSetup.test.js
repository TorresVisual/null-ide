'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountStore_1 = require("./accountStore");
const accountSetup_1 = require("./accountSetup");
const projectBinding_1 = require("./projectBinding");
const testFakes_1 = require("./testFakes");
function setup() {
    let n = 0;
    const meta = new testFakes_1.FakeMeta();
    const accounts = new accountStore_1.AccountStore(meta, new testFakes_1.FakeVault(), () => `id-${++n}`);
    const bindings = new projectBinding_1.ProjectBinding(meta, 'win32');
    return { accounts, bindings };
}
const octocat = {
    provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-1',
};
(0, node_test_1.test)('addOrReuse adds a new account', async () => {
    const { accounts } = setup();
    const account = await (0, accountSetup_1.addOrReuse)(accounts, octocat);
    node_assert_1.default.strictEqual(account.id, 'id-1');
    node_assert_1.default.strictEqual(accounts.list().length, 1);
});
(0, node_test_1.test)('addOrReuse reuses an existing account instead of rejecting a duplicate', async () => {
    const { accounts } = setup();
    const first = await (0, accountSetup_1.addOrReuse)(accounts, octocat);
    const again = await (0, accountSetup_1.addOrReuse)(accounts, { ...octocat, username: 'OctoCat' });
    node_assert_1.default.strictEqual(again.id, first.id);
    node_assert_1.default.strictEqual(accounts.list().length, 1);
    node_assert_1.default.strictEqual((0, accountSetup_1.findAccount)(accounts.list(), { ...octocat, username: 'hubot' }), undefined);
});
(0, node_test_1.test)('importExisting binds unbound open folders and leaves existing bindings alone', async () => {
    const { accounts, bindings } = setup();
    await bindings.bind('C:\\a', 'someone-else');
    const account = await (0, accountSetup_1.importExisting)(octocat, ['C:\\a', 'C:\\b'], accounts, bindings);
    node_assert_1.default.strictEqual(bindings.accountIdFor('C:\\a'), 'someone-else');
    node_assert_1.default.strictEqual(bindings.accountIdFor('C:\\b'), account.id);
});
(0, node_test_1.test)('importExisting twice does not duplicate the account', async () => {
    const { accounts, bindings } = setup();
    await (0, accountSetup_1.importExisting)(octocat, ['C:\\a'], accounts, bindings);
    await (0, accountSetup_1.importExisting)(octocat, ['C:\\a'], accounts, bindings);
    node_assert_1.default.strictEqual(accounts.list().length, 1);
});
function setupWithVault() {
    let n = 0;
    const vault = new testFakes_1.FakeVault();
    const accounts = new accountStore_1.AccountStore(new testFakes_1.FakeMeta(), vault, () => `id-${++n}`);
    return { accounts, vault };
}
const tanuki = {
    provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth', externalId: '7',
};
(0, node_test_1.test)('addOrRefresh adds a new account together with its tokens', async () => {
    const { accounts, vault } = setupWithVault();
    const account = await (0, accountSetup_1.addOrRefresh)(accounts, tanuki, 'tokens-1');
    node_assert_1.default.strictEqual(accounts.list().length, 1);
    node_assert_1.default.strictEqual(vault.data.get(`null-accounts/${account.id}`), 'tokens-1');
});
(0, node_test_1.test)('addOrRefresh on a stored account replaces its tokens instead of failing as a duplicate', async () => {
    const { accounts, vault } = setupWithVault();
    const first = await (0, accountSetup_1.addOrRefresh)(accounts, tanuki, 'tokens-1');
    const again = await (0, accountSetup_1.addOrRefresh)(accounts, { ...tanuki, username: 'Tanuki' }, 'tokens-2');
    node_assert_1.default.strictEqual(again.id, first.id);
    node_assert_1.default.strictEqual(accounts.list().length, 1);
    node_assert_1.default.strictEqual(vault.data.get(`null-accounts/${first.id}`), 'tokens-2');
});
(0, node_test_1.test)('addOrRefresh switches a stored account to the new sign-in method along with its secret', async () => {
    const { accounts, vault } = setupWithVault();
    const first = await (0, accountSetup_1.addOrRefresh)(accounts, tanuki, 'oauth-tokens');
    const again = await (0, accountSetup_1.addOrRefresh)(accounts, { ...tanuki, authMethod: 'https', externalId: '9' }, 'glpat-abc');
    node_assert_1.default.strictEqual(again.id, first.id);
    node_assert_1.default.strictEqual(again.authMethod, 'https');
    node_assert_1.default.strictEqual(accounts.get(first.id)?.authMethod, 'https');
    node_assert_1.default.strictEqual(vault.data.get(`null-accounts/${first.id}`), 'glpat-abc');
});
//# sourceMappingURL=accountSetup.test.js.map