'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const github_1 = require("./github");
const session = (id, login, token = 'tok') => ({ id: `s-${id}`, accessToken: token, account: { id, label: login }, scopes: github_1.GITHUB_SCOPES });
const emails = [
    { email: 'old@example.com', primary: false, verified: true },
    { email: 'octo@example.com', primary: true, verified: true },
];
function makeDeps(opts = {}) {
    const calls = [];
    const apiCalls = [];
    const deps = {
        getSession: async (scopes, options) => {
            calls.push({ scopes, options });
            if (opts.reject) {
                throw new Error('User did not consent to login.');
            }
            return opts.session;
        },
        api: async (path) => {
            apiCalls.push(path);
            const r = opts.api?.[path];
            if (r === undefined || r instanceof Error) {
                throw r ?? new Error(`GitHub API 404 for ${path}`);
            }
            return r;
        },
    };
    return { deps, calls, apiCalls };
}
const octocat = {
    id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-583231',
};
(0, node_test_1.test)('signIn forces a new session and describes the account from /user and the primary email', async () => {
    const { deps, calls } = makeDeps({
        session: session('vsc-583231', 'octocat'),
        api: { '/user': { id: 583231, login: 'octocat', email: null }, '/user/emails': emails },
    });
    const account = await new github_1.GithubProvider(deps).signIn();
    node_assert_1.default.deepStrictEqual(account, {
        provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
        externalId: 'vsc-583231', // the session's account id, not the numeric /user id
    });
    node_assert_1.default.deepStrictEqual(calls[0].scopes, github_1.GITHUB_SCOPES);
    node_assert_1.default.deepStrictEqual(calls[0].options, { forceNewSession: true });
});
(0, node_test_1.test)('signIn resolves undefined without calling the API when the user cancels', async () => {
    const { deps, apiCalls } = makeDeps({ reject: true });
    node_assert_1.default.strictEqual(await new github_1.GithubProvider(deps).signIn(), undefined);
    node_assert_1.default.deepStrictEqual(apiCalls, []);
});
(0, node_test_1.test)('signIn surfaces an API failure instead of storing a half-described account', async () => {
    const { deps } = makeDeps({ session: session('1', 'octocat') });
    await node_assert_1.default.rejects(new github_1.GithubProvider(deps).signIn(), /404/);
});
(0, node_test_1.test)('email falls back to the profile email, then to the noreply address, and never fails the sign-in', async () => {
    const user = { id: 583231, login: 'octocat', email: 'profile@example.com' };
    const emailFor = async (api) => (await new github_1.GithubProvider(makeDeps({ session: session('1', 'octocat'), api }).deps).signIn())?.email;
    // /user/emails unavailable (e.g. token lacks user:email) -> profile email
    node_assert_1.default.strictEqual(await emailFor({ '/user': user, '/user/emails': new Error('GitHub API 403') }), 'profile@example.com');
    // primary exists but is unverified -> ignored
    node_assert_1.default.strictEqual(await emailFor({ '/user': { ...user, email: null }, '/user/emails': [{ email: 'x@e.com', primary: true, verified: false }] }), '583231+octocat@users.noreply.github.com');
    // private email, nothing from /user/emails
    node_assert_1.default.strictEqual(await emailFor({ '/user': { ...user, email: null }, '/user/emails': 'not-a-list' }), '583231+octocat@users.noreply.github.com');
});
(0, node_test_1.test)('existing reads the signed-in session silently, and is undefined when there is none', async () => {
    const withSession = makeDeps({ session: session('1', 'octocat'), api: { '/user': { id: 1, login: 'octocat', email: 'o@e.com' }, '/user/emails': [] } });
    node_assert_1.default.strictEqual((await new github_1.GithubProvider(withSession.deps).existing())?.username, 'octocat');
    node_assert_1.default.deepStrictEqual(withSession.calls[0].options, { silent: true });
    node_assert_1.default.strictEqual(await new github_1.GithubProvider(makeDeps().deps).existing(), undefined);
});
(0, node_test_1.test)('getToken is silent by default, targets the account, and unions scopes with the defaults', async () => {
    const { deps, calls } = makeDeps({ session: session('vsc-583231', 'octocat', 'ghp_x') });
    const provider = new github_1.GithubProvider(deps);
    node_assert_1.default.strictEqual(await provider.getToken(octocat, ['read:org', 'repo']), 'ghp_x');
    node_assert_1.default.deepStrictEqual(calls[0].scopes, ['repo', 'user:email', 'read:org']);
    node_assert_1.default.deepStrictEqual(calls[0].options, { account: { id: 'vsc-583231', label: 'octocat' }, silent: true });
    await provider.getToken(octocat, undefined, { interactive: true });
    node_assert_1.default.deepStrictEqual(calls[1].scopes, github_1.GITHUB_SCOPES);
    node_assert_1.default.deepStrictEqual(calls[1].options, { account: { id: 'vsc-583231', label: 'octocat' }, createIfNone: true });
});
(0, node_test_1.test)('getToken refuses a session that belongs to a different GitHub account', async () => {
    const { deps } = makeDeps({ session: session('vsc-999', 'mallory', 'ghp_wrong') });
    node_assert_1.default.strictEqual(await new github_1.GithubProvider(deps).getToken(octocat, undefined, { interactive: true }), undefined);
});
(0, node_test_1.test)('getToken returns undefined without asking VS Code for accounts it cannot identify', async () => {
    const { deps, calls } = makeDeps({ session: session('x', 'y') });
    const provider = new github_1.GithubProvider(deps);
    node_assert_1.default.strictEqual(await provider.getToken({ ...octocat, externalId: undefined }), undefined);
    node_assert_1.default.strictEqual(await provider.getToken({ ...octocat, provider: 'gitlab' }), undefined);
    node_assert_1.default.deepStrictEqual(calls, []);
});
//# sourceMappingURL=github.test.js.map