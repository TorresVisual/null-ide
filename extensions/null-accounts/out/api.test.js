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
const folder = { fsPath: 'C:\\repo' };
const noopEvent = () => ({ dispose() { } });
function makeDeps(overrides = {}) {
    const all = [gh, gl];
    return {
        accounts: { list: () => all, get: id => all.find(a => a.id === id) },
        accountIdForFolder: () => undefined,
        chooseAccountForFolder: async () => undefined,
        tokenProviders: {},
        onDidChange: noopEvent,
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
(0, node_test_1.test)('ensureAccountForFolder returns the bound account without prompting', async () => {
    let prompted = 0;
    const api = (0, api_1.createApi)(makeDeps({ accountIdForFolder: () => 'a1', chooseAccountForFolder: async () => { prompted++; return gl; } }));
    node_assert_1.default.strictEqual(await api.ensureAccountForFolder(folder), gh);
    node_assert_1.default.strictEqual(prompted, 0);
});
(0, node_test_1.test)('ensureAccountForFolder prompts when unbound or dangling, and resolves undefined if the prompt fails', async () => {
    const picks = (0, api_1.createApi)(makeDeps({ chooseAccountForFolder: async () => gl }));
    node_assert_1.default.strictEqual(await picks.ensureAccountForFolder(folder), gl);
    const dangling = (0, api_1.createApi)(makeDeps({ accountIdForFolder: () => 'gone', chooseAccountForFolder: async () => gh }));
    node_assert_1.default.strictEqual(await dangling.ensureAccountForFolder(folder), gh);
    const broken = (0, api_1.createApi)(makeDeps({ chooseAccountForFolder: async () => { throw new Error('boom'); } }));
    node_assert_1.default.strictEqual(await broken.ensureAccountForFolder(folder), undefined);
});
(0, node_test_1.test)('getToken dispatches to the provider for the account and passes scopes and options through', async () => {
    const calls = [];
    const github = { getToken: async (a, scopes, options) => { calls.push([a.id, scopes, options]); return 'tok-gh'; } };
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github } }));
    node_assert_1.default.strictEqual(await api.getToken(gh, ['repo'], { interactive: true }), 'tok-gh');
    node_assert_1.default.deepStrictEqual(calls, [['a1', ['repo'], { interactive: true }]]);
});
(0, node_test_1.test)('getToken uses the stored account, not the caller-supplied fields, and refuses unknown accounts', async () => {
    const seen = [];
    const github = { getToken: async (a) => { seen.push(a); return 'tok-gh'; } };
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github } }));
    node_assert_1.default.strictEqual(await api.getToken({ ...gh, externalId: 'forged', username: 'mallory' }), 'tok-gh');
    node_assert_1.default.deepStrictEqual(seen, [gh]);
    node_assert_1.default.strictEqual(await api.getToken({ ...gh, id: 'not-stored' }), undefined);
    node_assert_1.default.strictEqual(seen.length, 1);
});
(0, node_test_1.test)('getToken resolves undefined when no provider is registered for the account', async () => {
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github: { getToken: async () => 'x' } } }));
    node_assert_1.default.strictEqual(await api.getToken(gl), undefined);
});
(0, node_test_1.test)('getToken resolves undefined, never rejects, when the provider throws', async () => {
    const api = (0, api_1.createApi)(makeDeps({ tokenProviders: { github: { getToken: async () => { throw new Error('offline'); } } } }));
    node_assert_1.default.strictEqual(await api.getToken(gh), undefined);
});
(0, node_test_1.test)('onDidChange is the supplied event, not a wrapper', () => {
    node_assert_1.default.strictEqual((0, api_1.createApi)(makeDeps()).onDidChange, noopEvent);
});
//# sourceMappingURL=api.test.js.map