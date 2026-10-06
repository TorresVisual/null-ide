'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const api_1 = require("./api");
const gh = { id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth' };
const gl = { id: 'a2', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const folder = { fsPath: 'C:\repo' };
const noopEvent = () => ({ dispose() { } });
function makeDeps(overrides = {}) {
    const all = [gh, gl];
    return {
        accounts: { list: () => all, get: id => all.find(a => a.id === id), onDidChange: noopEvent },
        accountIdForFolder: () => undefined,
        tokenProviders: {},
        ...overrides,
    };
}
(0, node_test_1.test)('getAccounts returns the stored accounts', () => {
    node_assert_1.default.deepStrictEqual((0, api_1.createApi)(makeDeps()).getAccounts(), [gh, gl]);
});
(0, node_test_1.test)('getAccountForFolder resolves the bound account, and undefined when unbound or dangling', () => {
    node_assert_1.default.strictEqual((0, api_1.createApi)(makeDeps({ accountIdForFolder: () => 'a2' })).getAccountForFolder(folder), gl);
    node_assert_1.default.strictEqual((0, api_1.createApi)(makeDeps()).getAccountForFolder(folder), undefined);
    // A binding that points at an account that has since been removed.
    node_assert_1.default.strictEqual((0, api_1.createApi)(makeDeps({ accountIdForFolder: () => 'gone' })).getAccountForFolder(folder), undefined);
});
(0, node_test_1.test)('getToken dispatches to the provider for the account and passes scopes through', async () => {
    const calls = [];
    const github = { getToken: async (a, scopes) => { calls.push([a.id, scopes]); return 'tok-gh'; } };
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github } }));
    node_assert_1.default.strictEqual(await api.getToken(gh, ['repo']), 'tok-gh');
    node_assert_1.default.deepStrictEqual(calls, [['a1', ['repo']]]);
});
(0, node_test_1.test)('getToken resolves undefined when no provider is registered for the account', async () => {
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github: { getToken: async () => 'x' } } }));
    node_assert_1.default.strictEqual(await api.getToken(gl), undefined);
});
(0, node_test_1.test)('getToken resolves undefined, never rejects, when the provider throws', async () => {
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github: { getToken: async () => { throw new Error('offline'); } } } }));
    node_assert_1.default.strictEqual(await api.getToken(gh), undefined);
});
(0, node_test_1.test)('onDidChange is the accounts source event', () => {
    const api = (0, api_1.createApi)(makeDeps());
    node_assert_1.default.strictEqual(api.onDidChange, noopEvent);
});
//# sourceMappingURL=api.test.js.map