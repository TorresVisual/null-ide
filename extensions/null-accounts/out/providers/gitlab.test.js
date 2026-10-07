'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const testFakes_1 = require("../testFakes");
const gitlab_1 = require("./gitlab");
const gitlabOAuth_1 = require("./gitlabOAuth");
const NOW = 1_000_000; // where fakeClock starts
const tanuki = {
    id: 'g1', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth', externalId: '7',
};
const device = {
    body: { device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device', expires_in: 300, interval: 5 },
};
const granted = { body: { access_token: 'at', refresh_token: 'rt', expires_in: 7200 } };
const refreshed = { body: { access_token: 'new', refresh_token: 'rt2', expires_in: 7200 } };
const versionOk = { status: 401, body: { message: '401 Unauthorized' } }; // /version needs a token: 401 is the normal answer
const profile = { status: 200, body: { id: 7, username: 'tanuki', email: 'tanuki@example.com' } };
const expired = { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW - 1 };
function make(opts = {}) {
    const { post, calls } = (0, testFakes_1.fakePost)(...(opts.replies ?? []));
    const clock = (0, testFakes_1.fakeClock)();
    const secrets = new Map();
    if (opts.tokens) {
        secrets.set(tanuki.id, (0, gitlabOAuth_1.serializeTokens)(opts.tokens));
    }
    const notified = [];
    const prompted = [];
    const getCalls = [];
    const deps = {
        post,
        get: async (host, apiPath, token) => {
            getCalls.push({ host, apiPath, token });
            if (opts.getFails) {
                throw new Error('offline');
            }
            return opts.gets?.[apiPath] ?? { status: 404, body: {} };
        },
        secrets: { get: async (id) => secrets.get(id), set: async (id, value) => { secrets.set(id, value); } },
        clientIdFor: () => ('clientId' in opts ? opts.clientId : 'cid'),
        now: clock.now,
        sleep: clock.sleep,
        onNeedsReauth: a => { notified.push(a.id); },
        promptReauth: async (a) => { prompted.push(a.id); opts.onPrompt?.(secrets); },
    };
    return { provider: new gitlab_1.GitlabProvider(deps), calls, getCalls, secrets, notified, prompted };
}
const ui = () => {
    const shown = [];
    return { shown, show: c => { shown.push(c.userCode); }, cancelled: () => false };
};
const signInGets = { '/version': versionOk, '/user': profile };
(0, node_test_1.test)('signIn runs the device flow and describes the account from /user', async () => {
    const { provider, calls, getCalls } = make({ replies: [device, granted], gets: signInGets });
    const u = ui();
    const { account, secret } = await provider.signIn('gitlab.com', u);
    node_assert_1.default.deepStrictEqual(account, {
        provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 'tanuki@example.com', authMethod: 'oauth', externalId: '7',
    });
    node_assert_1.default.deepStrictEqual(u.shown, ['UC']);
    node_assert_1.default.strictEqual(calls[0].form.client_id, 'cid');
    node_assert_1.default.deepStrictEqual((0, gitlabOAuth_1.parseTokens)(secret), { accessToken: 'at', refreshToken: 'rt', expiresAt: NOW + 5000 + 7_200_000 });
    node_assert_1.default.strictEqual(getCalls[getCalls.length - 1].token, 'at'); // /user is read with the new token
});
(0, node_test_1.test)('signIn on a self-hosted host with a port uses it in every URL and falls back to a noreply email', async () => {
    const { provider, calls, getCalls } = make({
        replies: [{ body: { ...device.body, verification_uri: 'https://git.example.org:8443/oauth/device' } }, granted],
        gets: { '/version': versionOk, '/user': { status: 200, body: { id: 7, username: 'tanuki' } } },
    });
    const { account } = await provider.signIn('git.example.org:8443', ui());
    node_assert_1.default.strictEqual(calls[0].url, 'https://git.example.org:8443/oauth/authorize_device');
    node_assert_1.default.strictEqual(getCalls[0].host, 'git.example.org:8443');
    node_assert_1.default.strictEqual(account.host, 'git.example.org:8443');
    node_assert_1.default.strictEqual(account.email, '7-tanuki@users.noreply.git.example.org'); // no port in the address
});
(0, node_test_1.test)('signIn without a client ID fails fast, naming the setting, before any network call', async () => {
    const { provider, calls, getCalls } = make({ clientId: undefined });
    await node_assert_1.default.rejects(provider.signIn('gitlab.com', ui()), /null-accounts\.gitlab/);
    node_assert_1.default.strictEqual(calls.length + getCalls.length, 0);
});
(0, node_test_1.test)('signIn rejects a host that is unreachable or not a GitLab server, before starting the flow', async () => {
    const notGitlab = make({ gets: { '/version': { status: 404, body: {} } } });
    await node_assert_1.default.rejects(notGitlab.provider.signIn('example.org', ui()), /does not look like a GitLab server/);
    const offline = make({ getFails: true });
    await node_assert_1.default.rejects(offline.provider.signIn('example.org', ui()), /Could not reach example\.org/);
    node_assert_1.default.strictEqual(notGitlab.calls.length + offline.calls.length, 0);
});
(0, node_test_1.test)('signIn fails clearly when the profile cannot be read', async () => {
    const { provider } = make({ replies: [device, granted], gets: { '/version': versionOk, '/user': { status: 403, body: {} } } });
    await node_assert_1.default.rejects(provider.signIn('gitlab.com', ui()), /profile/);
});
(0, node_test_1.test)('a fresh token is returned without any network call', async () => {
    const { provider, calls } = make({ tokens: { accessToken: 'live', refreshToken: 'rt1', expiresAt: NOW + 3_600_000 } });
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), 'live');
    node_assert_1.default.strictEqual(calls.length, 0);
});
(0, node_test_1.test)('a token inside the 60 s margin is refreshed, and the rotated pair is persisted', async () => {
    const { provider, calls, secrets } = make({
        tokens: { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW + 30_000 },
        replies: [refreshed],
    });
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), 'new');
    node_assert_1.default.deepStrictEqual(calls[0].form, { grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
    node_assert_1.default.deepStrictEqual((0, gitlabOAuth_1.parseTokens)(secrets.get('g1')), { accessToken: 'new', refreshToken: 'rt2', expiresAt: NOW + 7_200_000 });
});
(0, node_test_1.test)('if the refresh reply carries no new refresh token, the old one is kept', async () => {
    const { provider, secrets } = make({ tokens: expired, replies: [{ body: { access_token: 'new', expires_in: 7200 } }] });
    await provider.getToken(tanuki);
    node_assert_1.default.strictEqual((0, gitlabOAuth_1.parseTokens)(secrets.get('g1'))?.refreshToken, 'rt1');
});
(0, node_test_1.test)('two simultaneous requests with an expired token share a single refresh', async () => {
    const { provider, calls } = make({ tokens: expired, replies: [refreshed] }); // a 2nd request would throw
    const [a, b] = await Promise.all([provider.getToken(tanuki), provider.getToken(tanuki)]);
    node_assert_1.default.deepStrictEqual([a, b], ['new', 'new']);
    node_assert_1.default.strictEqual(calls.length, 1);
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), false);
});
(0, node_test_1.test)('a refresh the server rejects flags the account once, notifies once, and stops retrying', async () => {
    const { provider, calls, notified } = make({
        tokens: expired,
        replies: [{ status: 400, body: { error: 'invalid_grant' } }],
    });
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), undefined);
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), undefined); // no second request: it would throw
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), true);
    node_assert_1.default.deepStrictEqual(notified, ['g1']);
    node_assert_1.default.strictEqual(calls.length, 1);
});
(0, node_test_1.test)('an offline or failing server does not flag re-auth and leaves the stored tokens alone', async () => {
    const { provider, secrets } = make({ tokens: expired, replies: [{ status: 503, body: 'down' }] });
    const before = secrets.get('g1');
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), undefined);
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), false);
    node_assert_1.default.strictEqual(secrets.get('g1'), before);
});
(0, node_test_1.test)('an expired token with no refresh token, or no stored tokens at all, needs re-auth', async () => {
    const noRefresh = make({ tokens: { accessToken: 'old', expiresAt: NOW - 1 } });
    node_assert_1.default.strictEqual(await noRefresh.provider.getToken(tanuki), undefined);
    node_assert_1.default.strictEqual(noRefresh.provider.needsReauth('g1'), true);
    const nothing = make();
    node_assert_1.default.strictEqual(await nothing.provider.getToken(tanuki), undefined);
    node_assert_1.default.strictEqual(nothing.provider.needsReauth('g1'), true);
});
(0, node_test_1.test)('a missing client ID is not blamed on the sign-in: undefined, no flag', async () => {
    const { provider } = make({ tokens: expired, clientId: undefined });
    node_assert_1.default.strictEqual(await provider.getToken(tanuki), undefined);
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), false);
});
(0, node_test_1.test)('accounts of another provider get nothing', async () => {
    const { provider } = make();
    node_assert_1.default.strictEqual(await provider.getToken({ ...tanuki, provider: 'github' }), undefined);
});
(0, node_test_1.test)('only an interactive request prompts for re-auth, and it then returns the repaired token', async () => {
    const repair = (secrets) => {
        secrets.set('g1', (0, gitlabOAuth_1.serializeTokens)({ accessToken: 'fresh', expiresAt: NOW + 7_200_000 }));
    };
    const rejected = { status: 400, body: { error: 'invalid_grant' } };
    const silent = make({ tokens: expired, replies: [rejected], onPrompt: repair });
    node_assert_1.default.strictEqual(await silent.provider.getToken(tanuki), undefined);
    node_assert_1.default.deepStrictEqual(silent.prompted, []);
    const loud = make({ tokens: expired, replies: [rejected], onPrompt: repair });
    node_assert_1.default.strictEqual(await loud.provider.getToken(tanuki, undefined, { interactive: true }), 'fresh');
    node_assert_1.default.deepStrictEqual(loud.prompted, ['g1']);
    node_assert_1.default.strictEqual(loud.provider.needsReauth('g1'), false); // a good token clears the flag
});
(0, node_test_1.test)('reauthenticate stores the new tokens and clears the flag', async () => {
    const { provider, secrets } = make({ replies: [device, granted], gets: signInGets });
    await provider.getToken(tanuki); // no tokens yet: flagged
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), true);
    await provider.reauthenticate(tanuki, ui());
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), false);
    node_assert_1.default.strictEqual((0, gitlabOAuth_1.parseTokens)(secrets.get('g1'))?.accessToken, 'at');
});
(0, node_test_1.test)('reauthenticate refuses a different GitLab user and keeps the stored tokens', async () => {
    const { provider, secrets } = make({
        tokens: expired,
        replies: [device, granted],
        gets: { '/version': versionOk, '/user': { status: 200, body: { id: 9, username: 'someone-else', email: 's@e.com' } } },
    });
    const before = secrets.get('g1');
    await node_assert_1.default.rejects(provider.reauthenticate(tanuki, ui()), /signed in as someone-else.*tanuki/);
    node_assert_1.default.strictEqual(secrets.get('g1'), before);
});
(0, node_test_1.test)('needsReauth changes fire onDidChange so the panel refreshes', async () => {
    const { provider } = make();
    let fired = 0;
    provider.onDidChange(() => { fired++; });
    await provider.getToken(tanuki); // flags
    await provider.getToken(tanuki); // already flagged: no second event
    node_assert_1.default.strictEqual(fired, 1);
});
(0, node_test_1.test)('resolveClientId reads the gitlab.com setting for gitlab.com and the per-host map elsewhere', () => {
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('gitlab.com', ' abc ', {}), 'abc');
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('gitlab.com', '', {}), undefined);
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('git.example.org', 'abc', { 'git.example.org': 'zzz' }), 'zzz');
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('git.example.org', 'abc', {}), undefined); // gitlab.com's ID is not reused
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('git.example.org', 'abc', 'junk'), undefined);
    node_assert_1.default.strictEqual((0, gitlab_1.resolveClientId)('git.example.org', 'abc', { 'git.example.org': 5 }), undefined);
});
(0, node_test_1.test)('GitLab client IDs are application-scoped, so a workspace cannot swap in its own OAuth app', () => {
    const pkg = JSON.parse((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    for (const key of ['null-accounts.gitlab.clientId', 'null-accounts.gitlab.hostClientIds']) {
        node_assert_1.default.strictEqual(pkg.contributes.configuration.properties[key]?.scope, 'application', key);
    }
});
const pat = { ...tanuki, authMethod: 'https' };
(0, node_test_1.test)('signInWithToken validates the token against /user and describes the account', async () => {
    const { provider, calls, getCalls } = make({ gets: signInGets });
    const { account, secret } = await provider.signInWithToken('gitlab.com', ' glpat-abc ');
    node_assert_1.default.deepStrictEqual(account, {
        provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 'tanuki@example.com', authMethod: 'https', externalId: '7',
    });
    node_assert_1.default.strictEqual(secret, 'glpat-abc'); // stored raw, trimmed
    node_assert_1.default.strictEqual(getCalls[getCalls.length - 1].token, 'glpat-abc');
    node_assert_1.default.strictEqual(calls.length, 0); // no OAuth traffic, no client ID needed
});
(0, node_test_1.test)('signInWithToken works without any OAuth client ID configured', async () => {
    const { provider } = make({ clientId: undefined, gets: signInGets });
    await provider.signInWithToken('gitlab.com', 'glpat-abc');
});
(0, node_test_1.test)('signInWithToken explains a rejected token, an empty one, and a host that is not GitLab', async () => {
    const rejected = make({ gets: { '/version': versionOk, '/user': { status: 401, body: {} } } });
    await node_assert_1.default.rejects(rejected.provider.signInWithToken('gitlab.com', 'bad'), /token was rejected/);
    const empty = make({ gets: signInGets });
    await node_assert_1.default.rejects(empty.provider.signInWithToken('gitlab.com', '  '), /token/i);
    node_assert_1.default.strictEqual(empty.getCalls.length, 0);
    const notGitlab = make({ gets: { '/version': { status: 404, body: {} } } });
    await node_assert_1.default.rejects(notGitlab.provider.signInWithToken('example.org', 'x'), /does not look like a GitLab server/);
});
(0, node_test_1.test)('getToken returns a stored access token as is: no network, no refresh, no re-auth flag', async () => {
    const { provider, calls, getCalls, secrets } = make();
    secrets.set('g1', 'glpat-abc');
    node_assert_1.default.strictEqual(await provider.getToken(pat), 'glpat-abc');
    node_assert_1.default.strictEqual(calls.length + getCalls.length, 0);
});
(0, node_test_1.test)('a missing access token is undefined and never starts the OAuth re-auth prompt', async () => {
    const { provider, prompted } = make();
    node_assert_1.default.strictEqual(await provider.getToken(pat, undefined, { interactive: true }), undefined);
    node_assert_1.default.deepStrictEqual(prompted, []);
    node_assert_1.default.strictEqual(provider.needsReauth('g1'), false);
});
(0, node_test_1.test)('a rejected token reports the HTTP status and the reason GitLab gave', async () => {
    const scope = make({
        gets: { '/version': versionOk, '/user': { status: 403, body: { error: 'insufficient_scope', error_description: 'requires read_user, api' } } },
    });
    await node_assert_1.default.rejects(scope.provider.signInWithToken('gitlab.com', 'x'), /HTTP 403: requires read_user, api/);
    const bad = make({ gets: { '/version': versionOk, '/user': { status: 401, body: { message: '401 Unauthorized' } } } });
    await node_assert_1.default.rejects(bad.provider.signInWithToken('gitlab.com', 'x'), /HTTP 401: 401 Unauthorized/);
    const fine = make({ gets: { '/version': versionOk, '/user': { status: 403, body: { message: 'Access denied: requires a fine-grained personal access token with [User: Read]' } } } });
    await node_assert_1.default.rejects(fine.provider.signInWithToken('gitlab.com', 'x'), /fine-grained personal access token that includes the User: Read/);
});
//# sourceMappingURL=gitlab.test.js.map