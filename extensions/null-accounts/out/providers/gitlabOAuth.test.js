'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const testFakes_1 = require("../testFakes");
const gitlabOAuth_1 = require("./gitlabOAuth");
const code = {
    deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://gitlab.com/oauth/device', expiresIn: 300, interval: 5,
};
const pending = { status: 400, body: { error: 'authorization_pending' } };
const granted = { body: { access_token: 'at', refresh_token: 'rt', expires_in: 7200 } };
const failsWith = (reason) => (e) => e instanceof gitlabOAuth_1.OAuthError && e.reason === reason;
(0, node_test_1.test)('startDeviceFlow posts the client id and scopes and maps the response', async () => {
    const { post, calls } = (0, testFakes_1.fakePost)({
        body: {
            device_code: 'dc', user_code: 'UC', verification_uri: 'https://git.example.org:8443/oauth/device',
            verification_uri_complete: 'https://git.example.org:8443/oauth/device?user_code=UC', expires_in: 300, interval: 5,
        },
    });
    const got = await (0, gitlabOAuth_1.startDeviceFlow)(post, 'git.example.org:8443', 'cid');
    node_assert_1.default.strictEqual(calls[0].url, 'https://git.example.org:8443/oauth/authorize_device');
    node_assert_1.default.deepStrictEqual(calls[0].form, { client_id: 'cid', scope: 'read_user api write_repository' });
    node_assert_1.default.deepStrictEqual(got, {
        deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://git.example.org:8443/oauth/device',
        verificationUriComplete: 'https://git.example.org:8443/oauth/device?user_code=UC', expiresIn: 300, interval: 5,
    });
});
(0, node_test_1.test)('startDeviceFlow refuses an error reply, missing fields, and a non-https verification URL', async () => {
    const ok = { device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device' };
    for (const reply of [
        { status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } },
        { body: {} },
        { body: 'not json' },
        { body: { ...ok, verification_uri: 'http://gitlab.com/oauth/device' } },
        { body: { ...ok, verification_uri: 'javascript:alert(1)' } },
    ]) {
        await node_assert_1.default.rejects((0, gitlabOAuth_1.startDeviceFlow)((0, testFakes_1.fakePost)(reply).post, 'gitlab.com', 'cid'), failsWith('failed'), JSON.stringify(reply));
    }
});
(0, node_test_1.test)('startDeviceFlow drops a non-https verification_uri_complete but keeps the plain one', async () => {
    const { post } = (0, testFakes_1.fakePost)({
        body: {
            device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device',
            verification_uri_complete: 'http://evil.example/x',
        },
    });
    const got = await (0, gitlabOAuth_1.startDeviceFlow)(post, 'gitlab.com', 'cid');
    node_assert_1.default.strictEqual(got.verificationUriComplete, undefined);
    node_assert_1.default.strictEqual(got.expiresIn, 300); // defaults when the server omits them
    node_assert_1.default.strictEqual(got.interval, 5);
});
(0, node_test_1.test)('pollForToken waits one interval before each poll and returns the tokens when granted', async () => {
    const { post, calls } = (0, testFakes_1.fakePost)(pending, pending, granted);
    const clock = (0, testFakes_1.fakeClock)();
    const start = clock.now();
    const tokens = await (0, gitlabOAuth_1.pollForToken)(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
    node_assert_1.default.deepStrictEqual(clock.slept, [5000, 5000, 5000]);
    node_assert_1.default.deepStrictEqual(tokens, { accessToken: 'at', refreshToken: 'rt', expiresAt: start + 15_000 + 7_200_000 });
    node_assert_1.default.strictEqual(calls[0].url, 'https://gitlab.com/oauth/token');
    node_assert_1.default.deepStrictEqual(calls[0].form, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'dc', client_id: 'cid',
    });
});
(0, node_test_1.test)('slow_down lengthens the polling interval by 5 seconds', async () => {
    const { post } = (0, testFakes_1.fakePost)({ status: 400, body: { error: 'slow_down' } }, granted);
    const clock = (0, testFakes_1.fakeClock)();
    await (0, gitlabOAuth_1.pollForToken)(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
    node_assert_1.default.deepStrictEqual(clock.slept, [5000, 10_000]);
});
(0, node_test_1.test)('denied, server-expired and unknown errors end the flow with the right reason', async () => {
    const run = (body) => (0, gitlabOAuth_1.pollForToken)((0, testFakes_1.fakePost)({ status: 400, body }).post, 'gitlab.com', 'cid', code, { ...(0, testFakes_1.fakeClock)(), cancelled: () => false });
    await node_assert_1.default.rejects(run({ error: 'access_denied' }), failsWith('denied'));
    await node_assert_1.default.rejects(run({ error: 'expired_token' }), failsWith('expired'));
    await node_assert_1.default.rejects(run({ error: 'server_error', error_description: 'boom' }), failsWith('failed'));
    await node_assert_1.default.rejects(run(undefined), failsWith('failed'));
});
(0, node_test_1.test)('the flow also gives up on its own once the code lifetime has passed', async () => {
    const { post, calls } = (0, testFakes_1.fakePost)(pending, pending, pending);
    await node_assert_1.default.rejects((0, gitlabOAuth_1.pollForToken)(post, 'gitlab.com', 'cid', { ...code, expiresIn: 10, interval: 5 }, { ...(0, testFakes_1.fakeClock)(), cancelled: () => false }), failsWith('expired'));
    node_assert_1.default.strictEqual(calls.length, 1); // 5 s: poll; 10 s: out of time
});
(0, node_test_1.test)('a cancelled flow stops before asking the server again', async () => {
    const { post, calls } = (0, testFakes_1.fakePost)();
    await node_assert_1.default.rejects((0, gitlabOAuth_1.pollForToken)(post, 'gitlab.com', 'cid', code, { ...(0, testFakes_1.fakeClock)(), cancelled: () => true }), failsWith('cancelled'));
    node_assert_1.default.strictEqual(calls.length, 0);
});
(0, node_test_1.test)('refreshTokens posts the refresh grant and maps the rotated pair', async () => {
    const { post, calls } = (0, testFakes_1.fakePost)({ body: { access_token: 'new', refresh_token: 'rt2', expires_in: 7200 } });
    const clock = (0, testFakes_1.fakeClock)();
    const got = await (0, gitlabOAuth_1.refreshTokens)(post, 'gitlab.com', 'cid', 'rt1', clock.now);
    node_assert_1.default.deepStrictEqual(got, { accessToken: 'new', refreshToken: 'rt2', expiresAt: clock.now() + 7_200_000 });
    node_assert_1.default.deepStrictEqual(calls[0].form, { grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
});
(0, node_test_1.test)('refreshTokens: 400/401 means rejected; any other failure means transient', async () => {
    const run = (reply) => (0, gitlabOAuth_1.refreshTokens)((0, testFakes_1.fakePost)(reply).post, 'gitlab.com', 'cid', 'rt1', (0, testFakes_1.fakeClock)().now);
    await node_assert_1.default.rejects(run({ status: 400, body: { error: 'invalid_grant' } }), failsWith('rejected'));
    await node_assert_1.default.rejects(run({ status: 401, body: {} }), failsWith('rejected'));
    await node_assert_1.default.rejects(run({ status: 500, body: 'oops' }), failsWith('failed'));
    await node_assert_1.default.rejects(run({ status: 200, body: {} }), failsWith('failed')); // 200 without a token is not a refresh
    // a network failure is not an OAuthError at all: the caller treats it as transient too
    await node_assert_1.default.rejects((0, gitlabOAuth_1.refreshTokens)(async () => { throw new Error('offline'); }, 'gitlab.com', 'cid', 'rt1', (0, testFakes_1.fakeClock)().now), (e) => !(e instanceof gitlabOAuth_1.OAuthError));
});
(0, node_test_1.test)('tokens survive a serialise/parse round trip; junk parses to undefined', () => {
    const t = { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 };
    node_assert_1.default.deepStrictEqual((0, gitlabOAuth_1.parseTokens)((0, gitlabOAuth_1.serializeTokens)(t)), t);
    node_assert_1.default.deepStrictEqual((0, gitlabOAuth_1.parseTokens)((0, gitlabOAuth_1.serializeTokens)({ accessToken: 'at' })), { accessToken: 'at', refreshToken: undefined, expiresAt: undefined });
    for (const bad of [undefined, '', 'not json', '[]', '{}', '{"accessToken":""}', '{"accessToken":5}', 'null']) {
        node_assert_1.default.strictEqual((0, gitlabOAuth_1.parseTokens)(bad), undefined, String(bad));
    }
});
//# sourceMappingURL=gitlabOAuth.test.js.map