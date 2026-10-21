"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubApi_1 = require("../github/githubApi");
const widgetFetch_1 = require("./widgetFetch");
const issue = (repo, n) => ({ number: n, title: 't', url: `https://github.com/${repo}/issues/${n}`, updatedAt: '2026-10-21T10:00:00Z',
    repository: { nameWithOwner: repo }, labels: { nodes: [] }, assignees: { nodes: [] } });
const empty = { nodes: [] };
function deps(over = {}) {
    const calls = [];
    return { calls, token: async () => 'tok', localPaths: () => new Map(),
        graphql: (async (_q, vars) => {
            calls.push(vars);
            return { assigned: { nodes: [issue('a/b', 1), issue('c/d', 2)] }, mentioned: empty, authored: empty, reviewReq: empty };
        }), ...over };
}
(0, node_test_1.default)('no token means every repo is signed_out and nothing is requested', async () => {
    const d = deps({ token: async () => undefined });
    node_assert_1.default.deepStrictEqual(await (0, widgetFetch_1.fetchRepos)(d, 'acc', ['a/b', 'c/d']), [{ repo: 'a/b', reason: 'signed_out' }, { repo: 'c/d', reason: 'signed_out' }]);
    node_assert_1.default.strictEqual(d.calls.length, 0);
});
(0, node_test_1.default)('one request covers the repos and rows are split back per repo (case-insensitive)', async () => {
    const d = deps();
    const out = await (0, widgetFetch_1.fetchRepos)(d, 'acc', ['A/b', 'c/d', 'e/f']);
    node_assert_1.default.strictEqual(d.calls.length, 1);
    node_assert_1.default.strictEqual(d.calls[0].n, 20);
    node_assert_1.default.ok(String(d.calls[0].assigned).startsWith('repo:A/b repo:c/d repo:e/f '));
    node_assert_1.default.deepStrictEqual(out.map(r => [r.repo, 'issues' in r ? r.issues.length : -1]), [['A/b', 1], ['c/d', 1], ['e/f', 0]]);
});
(0, node_test_1.default)('a failing chunk marks only its repos; other chunks still succeed', async () => {
    const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
    let n = 0;
    const d = deps({ graphql: (async () => { if (n++ === 0)
            throw new githubApi_1.ApiError('boom', 500); return { assigned: empty, mentioned: empty, authored: empty, reviewReq: empty }; }) });
    const out = await (0, widgetFetch_1.fetchRepos)(d, 'acc', repos);
    node_assert_1.default.ok(out.some(r => 'reason' in r && r.reason === 'error') && out.some(r => 'issues' in r));
    node_assert_1.default.strictEqual(out.length, 12);
});
(0, node_test_1.default)('error classification', () => {
    node_assert_1.default.deepStrictEqual((0, widgetFetch_1.classifyError)(new githubApi_1.ApiError('Bad credentials', 401)), { reason: 'signed_out', retryAt: null });
    node_assert_1.default.deepStrictEqual((0, widgetFetch_1.classifyError)(new githubApi_1.ApiError('rate', 403, 1234)), { reason: 'error', retryAt: 1234 });
    node_assert_1.default.deepStrictEqual((0, widgetFetch_1.classifyError)(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), { reason: 'offline', retryAt: null });
    node_assert_1.default.deepStrictEqual((0, widgetFetch_1.classifyError)(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), { reason: 'offline', retryAt: null });
    node_assert_1.default.deepStrictEqual((0, widgetFetch_1.classifyError)(new Error('whatever')), { reason: 'error', retryAt: null });
});
//# sourceMappingURL=widgetFetch.test.js.map