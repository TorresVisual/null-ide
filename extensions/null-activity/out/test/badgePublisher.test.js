'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const badgePublisher_1 = require("../badgePublisher");
const MIN = 60_000;
const alice = { id: 'a1', username: 'alice' };
const bob = { id: 'b1', username: 'bob' };
function setup(over = {}) {
    const calls = [];
    const days = [{ day: '2026-10-08', ms: 60 * MIN }];
    const languages = [{ language: 'typescript', ms: 60 * MIN }];
    const tokenAsked = [];
    let state = over.state;
    const http = async (method, url, _headers, body) => {
        calls.push({ method, url, body });
        if (over.gate && calls.length === 1)
            await over.gate;
        if (over.gone && method === 'PATCH')
            return { status: 404, body: { message: 'Not Found' } };
        return { status: method === 'POST' ? 201 : 200, body: { id: 'g1', owner: { login: 'alice' } } };
    };
    const publisher = new badgePublisher_1.BadgePublisher({
        source: { getDailyStats: () => days, getLanguageStats: () => languages },
        accounts: async () => over.accounts ?? [alice],
        chooseAccount: async () => over.choose,
        token: async (_id, interactive) => {
            tokenAsked.push(interactive);
            if (over.tokenError)
                throw new Error('keychain locked');
            return 'token' in over ? over.token : 'tok';
        },
        http,
        state: { get: () => state, set: (s) => { state = s; } },
    });
    return { publisher, calls, days, tokenAsked, getState: () => state };
}
(0, node_test_1.test)('first manual publish creates a secret gist, remembers it and returns README markdown', async () => {
    const t = setup();
    const out = await t.publisher.publish({ interactive: true });
    if (!out.ok)
        throw new Error(out.message);
    node_assert_1.default.strictEqual(t.calls.length, 1);
    node_assert_1.default.strictEqual(t.calls[0].method, 'POST');
    node_assert_1.default.strictEqual(t.calls[0].body.public, false);
    node_assert_1.default.deepStrictEqual(Object.keys(t.calls[0].body.files), [
        'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
    ]);
    node_assert_1.default.strictEqual(t.getState()?.gistId, 'g1');
    node_assert_1.default.strictEqual(t.getState()?.accountId, 'a1');
    const lines = out.markdown.split('\n');
    node_assert_1.default.strictEqual(lines.length, 3);
    node_assert_1.default.strictEqual(lines[0], '![coding time](https://gist.githubusercontent.com/alice/g1/raw/null-activity-total.svg)');
});
(0, node_test_1.test)('no GitHub account: a message, and GitHub is not called', async () => {
    const t = setup({ accounts: [] });
    const out = await t.publisher.publish({ interactive: true });
    node_assert_1.default.strictEqual(out.ok, false);
    node_assert_1.default.match(out.message, /GitHub account/);
    node_assert_1.default.strictEqual(t.calls.length, 0);
});
(0, node_test_1.test)('auto-refresh never starts publishing and never asks for a token', async () => {
    const t = setup();
    const out = await t.publisher.publish({ interactive: false });
    node_assert_1.default.strictEqual(out.ok, false);
    node_assert_1.default.strictEqual(t.calls.length, 0);
    node_assert_1.default.deepStrictEqual(t.tokenAsked, []);
});
(0, node_test_1.test)('auto-refresh skips unchanged badges and updates changed ones, silently', async () => {
    const t = setup();
    await t.publisher.publish({ interactive: true });
    const same = await t.publisher.publish({ interactive: false });
    node_assert_1.default.deepStrictEqual(same.ok && same.changed, false);
    node_assert_1.default.strictEqual(t.calls.length, 1);
    t.days[0].ms = 120 * MIN;
    const changed = await t.publisher.publish({ interactive: false });
    node_assert_1.default.deepStrictEqual(changed.ok && changed.changed, true);
    node_assert_1.default.strictEqual(t.calls.length, 2);
    node_assert_1.default.strictEqual(t.calls[1].method, 'PATCH');
    node_assert_1.default.ok(t.calls[1].url.endsWith('/gists/g1'));
    node_assert_1.default.strictEqual(t.tokenAsked[t.tokenAsked.length - 1], false);
});
(0, node_test_1.test)('a manual publish always pushes, even when nothing changed', async () => {
    const t = setup();
    await t.publisher.publish({ interactive: true });
    await t.publisher.publish({ interactive: true });
    node_assert_1.default.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});
(0, node_test_1.test)('no token, or a token provider that throws: a failure, GitHub not called', async () => {
    const none = setup({ token: undefined });
    node_assert_1.default.strictEqual((await none.publisher.publish({ interactive: true })).ok, false);
    node_assert_1.default.strictEqual(none.calls.length, 0);
    const broken = setup({ tokenError: true });
    const out = await broken.publisher.publish({ interactive: true });
    node_assert_1.default.strictEqual(out.ok, false);
    node_assert_1.default.match(out.message, /keychain locked/);
    node_assert_1.default.strictEqual(broken.calls.length, 0);
});
(0, node_test_1.test)('several accounts: asks which one; cancelling stops, choosing remembers it', async () => {
    const cancelled = setup({ accounts: [alice, bob] });
    node_assert_1.default.strictEqual((await cancelled.publisher.publish({ interactive: true })).ok, false);
    node_assert_1.default.strictEqual(cancelled.calls.length, 0);
    const chosen = setup({ accounts: [alice, bob], choose: bob });
    node_assert_1.default.strictEqual((await chosen.publisher.publish({ interactive: true })).ok, true);
    node_assert_1.default.strictEqual(chosen.getState()?.accountId, 'b1');
});
(0, node_test_1.test)('the remembered account is used without asking; a removed account starts over with a new gist', async () => {
    const remembered = setup({ accounts: [alice, bob], state: { gistId: 'g1', accountId: 'b1', owner: 'bob', hash: 'old' } });
    await remembered.publisher.publish({ interactive: true });
    node_assert_1.default.strictEqual(remembered.calls[0].method, 'PATCH');
    const removed = setup({ accounts: [alice], state: { gistId: 'old', accountId: 'gone', owner: 'x', hash: 'old' } });
    await removed.publisher.publish({ interactive: true });
    node_assert_1.default.strictEqual(removed.calls[0].method, 'POST');
    node_assert_1.default.strictEqual(removed.getState()?.accountId, 'a1');
});
(0, node_test_1.test)('auto-refresh never re-creates a gist the user deleted; a manual publish does', async () => {
    const state = { gistId: 'g1', accountId: 'a1', owner: 'alice', hash: 'old' };
    const auto = setup({ gone: true, state });
    const out = await auto.publisher.publish({ interactive: false });
    node_assert_1.default.strictEqual(out.ok, false);
    node_assert_1.default.deepStrictEqual(auto.calls.map((c) => c.method), ['PATCH']);
    const manual = setup({ gone: true, state });
    node_assert_1.default.strictEqual((await manual.publisher.publish({ interactive: true })).ok, true);
    node_assert_1.default.deepStrictEqual(manual.calls.map((c) => c.method), ['PATCH', 'POST']);
});
(0, node_test_1.test)('publishes are serialised: a second call waits for the first', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const t = setup({ gate });
    const first = t.publisher.publish({ interactive: true });
    const second = t.publisher.publish({ interactive: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    node_assert_1.default.strictEqual(t.calls.length, 1);
    release();
    await Promise.all([first, second]);
    node_assert_1.default.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});
//# sourceMappingURL=badgePublisher.test.js.map