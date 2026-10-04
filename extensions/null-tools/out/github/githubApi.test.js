'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_events_1 = require("node:events");
const node_https_1 = __importDefault(require("node:https"));
const node_test_1 = __importStar(require("node:test"));
const githubApi_1 = require("./githubApi");
(0, node_test_1.afterEach)(() => node_test_1.mock.restoreAll());
(0, node_test_1.default)('formatApiError: REST validation error lists each field error', () => {
    const body = JSON.stringify({
        message: 'Validation Failed',
        errors: [{ resource: 'Issue', code: 'invalid', field: 'assignees' }],
    });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), 'GitHub API 422: Validation Failed · assignees invalid');
});
(0, node_test_1.default)("formatApiError: prefers an error entry's own message", () => {
    const body = JSON.stringify({
        message: 'Validation Failed',
        errors: [{ message: "Could not resolve to a User with the login of 'ghost'." }],
    });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), "GitHub API 422: Validation Failed · Could not resolve to a User with the login of 'ghost'.");
});
(0, node_test_1.default)('formatApiError: plain message, documentation_url ignored', () => {
    const body = JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(401, body), 'GitHub API 401: Bad credentials');
});
(0, node_test_1.default)('formatApiError: string entries in errors[]', () => {
    const body = JSON.stringify({ message: 'Validation Failed', errors: ['title is too long'] });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), 'GitHub API 422: Validation Failed · title is too long');
});
(0, node_test_1.default)('formatApiError: GraphQL errors on a 200 response', () => {
    const body = JSON.stringify({ errors: [{ message: "Field 'foo' doesn't exist on type 'Issue'" }] });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(200, body), "GitHub API error: Field 'foo' doesn't exist on type 'Issue'");
});
(0, node_test_1.default)('formatApiError: non-JSON body (proxy HTML) shows only the status', () => {
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(502, '<html><body>Bad gateway</body></html>'), 'GitHub API 502');
});
(0, node_test_1.default)('formatApiError: empty or null body', () => {
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(404, ''), 'GitHub API 404');
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(500, 'null'), 'GitHub API 500');
});
/** Makes https.request answer with a canned response, so requestGraphql can be tested without the network. */
function stubGitHub(status, body, headers = {}) {
    node_test_1.mock.method(node_https_1.default, 'request', (_url, _opts, onResponse) => {
        const req = Object.assign(new node_events_1.EventEmitter(), {
            setTimeout() { }, write() { }, destroy() { },
            end() {
                const res = Object.assign(new node_events_1.EventEmitter(), { statusCode: status, headers, setEncoding() { } });
                onResponse(res);
                res.emit('data', body);
                res.emit('end');
            },
        });
        return req;
    });
}
(0, node_test_1.default)('requestGraphql resolves to data', async () => {
    stubGitHub(200, JSON.stringify({ data: { viewer: { login: 'octocat' } } }));
    node_assert_1.default.deepStrictEqual(await (0, githubApi_1.requestGraphql)('query{viewer{login}}', {}, 't'), { viewer: { login: 'octocat' } });
});
(0, node_test_1.default)('requestGraphql rejects on errors[] even when partial data came back', async () => {
    stubGitHub(200, JSON.stringify({ data: { viewer: null }, errors: [{ message: "Field 'foo' doesn't exist" }] }));
    await node_assert_1.default.rejects((0, githubApi_1.requestGraphql)('q', {}, 't'), (err) => {
        node_assert_1.default.ok(err instanceof githubApi_1.ApiError);
        node_assert_1.default.strictEqual(err.message, "GitHub API error: Field 'foo' doesn't exist");
        return true;
    });
});
(0, node_test_1.default)('requestGraphql: a rate-limit error carries when to retry', async () => {
    stubGitHub(200, JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), {
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000',
    });
    await node_assert_1.default.rejects((0, githubApi_1.requestGraphql)('q', {}, 't'), (err) => err.retryAt === 1800000000 * 1000);
});
(0, node_test_1.default)('requestGraphql: a 401 is an ApiError with its status and no retry time', async () => {
    stubGitHub(401, JSON.stringify({ message: 'Bad credentials' }));
    await node_assert_1.default.rejects((0, githubApi_1.requestGraphql)('q', {}, 't'), (err) => err.status === 401 && err.retryAt === null && err.message === 'GitHub API 401: Bad credentials');
});
(0, node_test_1.default)('requestGraphql: a secondary rate limit (403 + retry-after) carries a retry time', async () => {
    stubGitHub(403, JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { 'retry-after': '30' });
    const before = Date.now();
    await node_assert_1.default.rejects((0, githubApi_1.requestGraphql)('q', {}, 't'), (err) => err.retryAt !== null && err.retryAt >= before + 30000 && err.retryAt < before + 31000);
});
(0, node_test_1.default)('rateLimitRetryAt: Retry-After wins, then the reset time, else null', () => {
    node_assert_1.default.strictEqual((0, githubApi_1.rateLimitRetryAt)({ 'retry-after': '60' }, 1000), 61000);
    node_assert_1.default.strictEqual((0, githubApi_1.rateLimitRetryAt)({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }), 2000000);
    node_assert_1.default.strictEqual((0, githubApi_1.rateLimitRetryAt)({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '2000' }), null);
    node_assert_1.default.strictEqual((0, githubApi_1.rateLimitRetryAt)({}), null);
});
//# sourceMappingURL=githubApi.test.js.map