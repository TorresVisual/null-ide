'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const gistClient_1 = require("../gistClient");
const files = [{ name: 'a.svg', content: '<svg/>' }, { name: 'b.svg', content: '<svg b/>' }];
const OK = { id: 'g1', owner: { login: 'alice' } };
function fake(replies) {
    const calls = [];
    const http = async (method, url, headers, body) => {
        calls.push({ method, url, headers, body });
        const next = replies.shift();
        if (next instanceof Error)
            throw next;
        return next;
    };
    return { http, calls };
}
(0, node_test_1.test)('creates a secret gist and reports its id and owner', async () => {
    const { http, calls } = fake([{ status: 201, body: OK }]);
    const result = await (0, gistClient_1.publishGist)(http, 'tok', undefined, files);
    node_assert_1.default.deepStrictEqual(result, { ok: true, id: 'g1', owner: 'alice' });
    node_assert_1.default.strictEqual(calls[0].method, 'POST');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/gists');
    node_assert_1.default.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
    node_assert_1.default.strictEqual(calls[0].body.public, false);
    node_assert_1.default.deepStrictEqual(calls[0].body.files, { 'a.svg': { content: '<svg/>' }, 'b.svg': { content: '<svg b/>' } });
});
(0, node_test_1.test)('updates an existing gist in place', async () => {
    const { http, calls } = fake([{ status: 200, body: OK }]);
    node_assert_1.default.deepStrictEqual(await (0, gistClient_1.publishGist)(http, 'tok', 'g1', files), { ok: true, id: 'g1', owner: 'alice' });
    node_assert_1.default.strictEqual(calls[0].method, 'PATCH');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/gists/g1');
    node_assert_1.default.ok(!('public' in calls[0].body));
});
(0, node_test_1.test)('404 on update means the gist was deleted: create a new one', async () => {
    const { http, calls } = fake([{ status: 404, body: { message: 'Not Found' } }, { status: 201, body: { id: 'g2', owner: { login: 'alice' } } }]);
    node_assert_1.default.deepStrictEqual(await (0, gistClient_1.publishGist)(http, 'tok', 'g1', files), { ok: true, id: 'g2', owner: 'alice' });
    node_assert_1.default.deepStrictEqual(calls.map((c) => c.method), ['PATCH', 'POST']);
});
(0, node_test_1.test)('401/403 explain the missing scope and never echo the token', async () => {
    for (const status of [401, 403]) {
        const result = await (0, gistClient_1.publishGist)(fake([{ status, body: { message: 'Bad credentials' } }]).http, 'secret-token', undefined, files);
        node_assert_1.default.strictEqual(result.ok, false);
        const message = result.message;
        node_assert_1.default.ok(message.includes(`HTTP ${status}`));
        node_assert_1.default.ok(message.includes('gist'));
        node_assert_1.default.ok(!message.includes('secret-token'));
    }
});
(0, node_test_1.test)('other statuses and malformed success bodies become a message', async () => {
    const server = await (0, gistClient_1.publishGist)(fake([{ status: 500, body: { message: 'boom' } }]).http, 't', undefined, files);
    node_assert_1.default.deepStrictEqual(server, { ok: false, message: 'GitHub answered HTTP 500: boom' });
    const malformed = await (0, gistClient_1.publishGist)(fake([{ status: 201, body: { nope: true } }]).http, 't', undefined, files);
    node_assert_1.default.deepStrictEqual(malformed, { ok: false, message: 'GitHub answered HTTP 201.' });
});
(0, node_test_1.test)('a network failure is a result, not a throw', async () => {
    const result = await (0, gistClient_1.publishGist)(fake([new Error('ETIMEDOUT')]).http, 't', undefined, files);
    node_assert_1.default.deepStrictEqual(result, { ok: false, message: 'Could not reach GitHub (ETIMEDOUT).' });
});
(0, node_test_1.test)('raw URL has no revision so it always serves the latest file', () => {
    node_assert_1.default.strictEqual((0, gistClient_1.gistRawUrl)('alice', 'g1', 'a.svg'), 'https://gist.githubusercontent.com/alice/g1/raw/a.svg');
});
//# sourceMappingURL=gistClient.test.js.map