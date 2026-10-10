'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const defaultAccount_1 = require("./defaultAccount");
const projectBinding_1 = require("./projectBinding");
const testFakes_1 = require("./testFakes");
const acct = (id, host = 'github.com') => ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });
function setup(origins = {}) {
    const bindings = new projectBinding_1.ProjectBinding(new testFakes_1.FakeMeta(), 'linux');
    const list = [acct('a1'), acct('a2', 'gitlab.example.org')];
    const deps = {
        bindings,
        accounts: { list: () => list, get: (id) => list.find(a => a.id === id) },
        originUrl: async (folder) => origins[folder],
    };
    return { bindings, deps };
}
(0, node_test_1.test)('does nothing while no default is set, or when the default account is gone', async () => {
    const { bindings, deps } = setup();
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a']);
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/a'), undefined);
    await bindings.setDefault('ghost');
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a']);
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/a'), undefined);
});
(0, node_test_1.test)('an unbound folder gets the default; a bound one keeps its account', async () => {
    const { bindings, deps } = setup();
    await bindings.setDefault('a1');
    await bindings.bind('/work/b', 'a2');
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a', '/work/b']);
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/a'), 'a1');
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/b'), 'a2');
});
(0, node_test_1.test)('an account that matches the origin remote wins over the default', async () => {
    const { bindings, deps } = setup({ '/work/a': 'git@gitlab.example.org:me/app.git' });
    await bindings.setDefault('a1');
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a']);
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/a'), 'a2');
});
(0, node_test_1.test)('a folder the user unbound is not given the default again', async () => {
    const { bindings, deps } = setup();
    await bindings.setDefault('a1');
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a']);
    await bindings.unbind('/work/a');
    await (0, defaultAccount_1.applyDefaultAccount)(deps, ['/work/a']);
    node_assert_1.default.strictEqual(bindings.accountIdFor('/work/a'), undefined);
});
//# sourceMappingURL=defaultAccount.test.js.map