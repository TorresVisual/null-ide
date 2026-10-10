'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const keyUpload_1 = require("./keyUpload");
const KEY = { type: 'ssh-ed25519', blob: 'AAAAC3', comment: 'ada@uni.example', line: 'ssh-ed25519 AAAAC3 ada@uni.example' };
const TOKEN = 'tok-secret-123';
const github = { provider: 'github', host: 'github.com' };
const gitlab = { provider: 'gitlab', host: 'git.uni.example' };
function fakePost(...replies) {
    const calls = [];
    const post = async (url, headers, body) => {
        calls.push({ url, headers, body });
        const next = replies.shift();
        if (!next) {
            throw new Error('unexpected extra request');
        }
        return next;
    };
    return { post, calls };
}
const GH_DUPLICATE = { status: 422, body: { message: 'Validation Failed', errors: [{ message: 'key is already in use' }] } };
(0, node_test_1.test)('GitHub: the key is added for authentication and again as a signing key, comment left off', async () => {
    const { post, calls } = fakePost({ status: 201, body: {} }, { status: 201, body: {} });
    node_assert_1.default.deepStrictEqual(await (0, keyUpload_1.uploadPublicKey)(github, TOKEN, KEY, 'Null IDE on PC', post), { ok: true, already: false });
    node_assert_1.default.deepStrictEqual(calls.map(c => c.url), ['https://api.github.com/user/keys', 'https://api.github.com/user/ssh_signing_keys']);
    node_assert_1.default.deepStrictEqual(calls[0].body, { title: 'Null IDE on PC', key: 'ssh-ed25519 AAAAC3' });
    node_assert_1.default.strictEqual(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
});
(0, node_test_1.test)('GitHub: a key the account already has is a success, not an error', async () => {
    const { post } = fakePost(GH_DUPLICATE, GH_DUPLICATE);
    node_assert_1.default.deepStrictEqual(await (0, keyUpload_1.uploadPublicKey)(github, TOKEN, KEY, 't', post), { ok: true, already: true });
});
(0, node_test_1.test)('GitHub: if only the signing-key step fails, the message says the key was added but not for signing', async () => {
    const { post } = fakePost({ status: 201, body: {} }, { status: 403, body: { message: 'Resource not accessible' } });
    const result = await (0, keyUpload_1.uploadPublicKey)(github, TOKEN, KEY, 't', post);
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.match(result.message, /added for pushing, but not as a signing key/);
});
(0, node_test_1.test)('GitHub: a refused sign-in says which permission to allow, stops after one request, and never repeats the token', async () => {
    const { post, calls } = fakePost({ status: 403, body: { message: 'Must have admin rights' } });
    const result = await (0, keyUpload_1.uploadPublicKey)(github, TOKEN, KEY, 't', post);
    node_assert_1.default.strictEqual(result.ok, false);
    const message = result.message;
    node_assert_1.default.match(message, /write:public_key/);
    node_assert_1.default.ok(!message.includes(TOKEN));
    node_assert_1.default.strictEqual(calls.length, 1);
});
(0, node_test_1.test)('GitLab: one request adds the key for authentication and signing; duplicates and refusals are told apart', async () => {
    const ok = fakePost({ status: 201, body: {} });
    node_assert_1.default.deepStrictEqual(await (0, keyUpload_1.uploadPublicKey)(gitlab, TOKEN, KEY, 'Null IDE on PC', ok.post), { ok: true, already: false });
    node_assert_1.default.strictEqual(ok.calls[0].url, 'https://git.uni.example/api/v4/user/keys');
    node_assert_1.default.deepStrictEqual(ok.calls[0].body, { title: 'Null IDE on PC', key: 'ssh-ed25519 AAAAC3', usage_type: 'auth_and_signing' });
    node_assert_1.default.strictEqual(ok.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    const dup = fakePost({ status: 400, body: { message: { fingerprint: ['has already been taken'], key: ['has already been taken'] } } });
    node_assert_1.default.deepStrictEqual(await (0, keyUpload_1.uploadPublicKey)(gitlab, TOKEN, KEY, 't', dup.post), { ok: true, already: true });
    const denied = fakePost({ status: 403, body: { message: '403 Forbidden' } });
    const refusal = await (0, keyUpload_1.uploadPublicKey)(gitlab, TOKEN, KEY, 't', denied.post);
    node_assert_1.default.match(refusal.message, /"api" scope/);
});
(0, node_test_1.test)('a network failure is reported as unreachable, with the host', async () => {
    const post = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
    const result = await (0, keyUpload_1.uploadPublicKey)(gitlab, TOKEN, KEY, 't', post);
    node_assert_1.default.deepStrictEqual(result, { ok: false, message: 'Could not reach git.uni.example.' });
});
(0, node_test_1.test)('the settings page to paste a key into, and the scopes GitHub needs', () => {
    node_assert_1.default.strictEqual((0, keyUpload_1.keySettingsUrl)(github), 'https://github.com/settings/ssh/new');
    node_assert_1.default.strictEqual((0, keyUpload_1.keySettingsUrl)(gitlab), 'https://git.uni.example/-/user_settings/ssh_keys');
    node_assert_1.default.deepStrictEqual(keyUpload_1.GITHUB_KEY_SCOPES, ['write:public_key', 'write:ssh_signing_key']);
});
//# sourceMappingURL=keyUpload.test.js.map