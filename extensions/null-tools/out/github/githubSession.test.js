'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const githubSession_1 = require("./githubSession");
const folder = { fsPath: 'C:\\repo' };
const octocat = { provider: 'github', username: 'octocat' };
const tanuki = { provider: 'gitlab', username: 'tanuki' };
function makeApi(opts = {}) {
    const log = [];
    const api = {
        getAccountForFolder: () => opts.bound,
        ensureAccountForFolder: async () => { log.push('ensure'); return opts.picked; },
        getToken: async (_account, scopes, options) => { log.push(`token:${scopes}:${options?.interactive}`); return opts.token; },
        onDidChange: () => ({ dispose() { } }),
    };
    return { api, log };
}
(0, node_test_1.test)('a bound GitHub account yields its token and login, silently when not interactive', async () => {
    const { api, log } = makeApi({ bound: octocat, token: 'ghp_x' });
    node_assert_1.default.deepStrictEqual(await (0, githubSession_1.resolveGithubSession)(api, folder, false), { accessToken: 'ghp_x', login: 'octocat' });
    node_assert_1.default.deepStrictEqual(log, ['token:repo:false']);
});
(0, node_test_1.test)('an unbound folder stays signed out when silent, and prompts to pick or add when interactive', async () => {
    const silent = makeApi({ token: 'ghp_x' });
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(silent.api, folder, false), undefined);
    node_assert_1.default.deepStrictEqual(silent.log, []);
    const interactive = makeApi({ picked: octocat, token: 'ghp_x' });
    node_assert_1.default.deepStrictEqual(await (0, githubSession_1.resolveGithubSession)(interactive.api, folder, true), { accessToken: 'ghp_x', login: 'octocat' });
    node_assert_1.default.deepStrictEqual(interactive.log, ['ensure', 'token:repo:true']);
    const cancelled = makeApi({});
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(cancelled.api, folder, true), undefined);
});
(0, node_test_1.test)('a folder bound to a non-GitHub account never gets a GitHub session', async () => {
    const { api, log } = makeApi({ bound: tanuki, token: 'glpat_x' });
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(api, folder, true), undefined);
    node_assert_1.default.deepStrictEqual(log, []);
});
(0, node_test_1.test)('no token, no accounts extension, or no folder all resolve undefined', async () => {
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(makeApi({ bound: octocat }).api, folder, false), undefined);
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(undefined, folder, true), undefined);
    node_assert_1.default.strictEqual(await (0, githubSession_1.resolveGithubSession)(makeApi({ bound: octocat, token: 't' }).api, undefined, true), undefined);
});
//# sourceMappingURL=githubSession.test.js.map