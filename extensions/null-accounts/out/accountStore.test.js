'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountStore_1 = require("./accountStore");
const testFakes_1 = require("./testFakes");
function makeStore() {
    let n = 0;
    const meta = new testFakes_1.FakeMeta();
    const vault = new testFakes_1.FakeVault();
    const store = new accountStore_1.AccountStore(meta, vault, () => `id-${++n}`);
    return { store, meta, vault };
}
const octocat = {
    provider: 'github', host: 'github.com', username: 'octocat', email: 'octocat@example.com', authMethod: 'oauth',
};
(0, node_test_1.test)('add persists metadata and keeps the secret out of it', async () => {
    const { store, meta, vault } = makeStore();
    const account = await store.add(octocat, 'ghp_supersecret');
    node_assert_1.default.strictEqual(account.id, 'id-1');
    node_assert_1.default.deepStrictEqual(store.list(), [account]);
    node_assert_1.default.strictEqual(await store.getSecret('id-1'), 'ghp_supersecret');
    node_assert_1.default.strictEqual(vault.data.get('null-accounts/id-1'), 'ghp_supersecret');
    node_assert_1.default.ok(!JSON.stringify([...meta.data.entries()]).includes('ghp_supersecret'), 'secret leaked into metadata');
});
(0, node_test_1.test)('add without a secret stores no vault entry', async () => {
    const { store, vault } = makeStore();
    await store.add(octocat);
    node_assert_1.default.strictEqual(vault.data.size, 0);
});
(0, node_test_1.test)('list returns copies, so callers cannot mutate stored state', async () => {
    const { store } = makeStore();
    await store.add(octocat);
    store.list()[0].username = 'mallory';
    node_assert_1.default.strictEqual(store.list()[0].username, 'octocat');
});
(0, node_test_1.test)('add rejects a duplicate provider+host+username, ignoring case and host formatting', async () => {
    const { store } = makeStore();
    await store.add(octocat);
    await node_assert_1.default.rejects(store.add({ ...octocat, username: 'OctoCat', host: 'HTTPS://GITHUB.COM/' }), /already/i);
    node_assert_1.default.strictEqual(store.list().length, 1);
    // Same login on a different host, or a different login on the same host, is fine.
    await store.add({ ...octocat, provider: 'gitlab', host: 'gitlab.com' });
    await store.add({ ...octocat, username: 'hubot' });
    node_assert_1.default.strictEqual(store.list().length, 3);
});
(0, node_test_1.test)('a failed add leaves no orphan secret and fires no event', async () => {
    const { store, vault } = makeStore();
    let fired = 0;
    store.onDidChange(() => fired++);
    await node_assert_1.default.rejects(store.add({ ...octocat, host: 'http://github.com' }, 'tok'), /http/i);
    node_assert_1.default.strictEqual(vault.data.size, 0);
    node_assert_1.default.strictEqual(fired, 0);
});
(0, node_test_1.test)('update patches fields, fires one event, and rejects a patch that creates a duplicate', async () => {
    const { store } = makeStore();
    const a = await store.add(octocat);
    await store.add({ ...octocat, username: 'hubot' });
    let fired = 0;
    store.onDidChange(() => fired++);
    const updated = await store.update(a.id, { email: 'new@example.com' });
    node_assert_1.default.strictEqual(updated.email, 'new@example.com');
    node_assert_1.default.strictEqual(store.get(a.id)?.email, 'new@example.com');
    node_assert_1.default.strictEqual(fired, 1);
    // Re-saving an account with its own username is not a duplicate of itself.
    await store.update(a.id, { username: 'octocat' });
    await node_assert_1.default.rejects(store.update(a.id, { username: 'hubot' }), /already/i);
    await node_assert_1.default.rejects(store.update('missing', { email: 'x@example.com' }), /no account/i);
});
(0, node_test_1.test)('remove deletes the account and its secret and fires one event', async () => {
    const { store, vault } = makeStore();
    const a = await store.add(octocat, 'tok');
    let fired = 0;
    store.onDidChange(() => fired++);
    await store.remove(a.id);
    node_assert_1.default.deepStrictEqual(store.list(), []);
    node_assert_1.default.strictEqual(vault.data.size, 0);
    node_assert_1.default.strictEqual(fired, 1);
});
(0, node_test_1.test)('removing an unknown account is a silent no-op', async () => {
    const { store } = makeStore();
    let fired = 0;
    store.onDidChange(() => fired++);
    await store.remove('nope');
    node_assert_1.default.strictEqual(fired, 0);
});
(0, node_test_1.test)('list ignores corrupt stored data instead of throwing', async () => {
    const { store, meta } = makeStore();
    meta.data.set(accountStore_1.ACCOUNTS_KEY, 'garbage');
    node_assert_1.default.deepStrictEqual(store.list(), []);
    const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' };
    meta.data.set(accountStore_1.ACCOUNTS_KEY, ['x', null, { id: 1 }, { ...good, provider: 'bitbucket' }, good]);
    node_assert_1.default.deepStrictEqual(store.list(), [good]);
});
(0, node_test_1.test)('setSecret refuses an unknown account so no orphan secret is created', async () => {
    const { store, vault } = makeStore();
    await node_assert_1.default.rejects(store.setSecret('nope', 'tok'), /no account/i);
    node_assert_1.default.strictEqual(vault.data.size, 0);
    const a = await store.add(octocat);
    await store.setSecret(a.id, 'tok2');
    node_assert_1.default.strictEqual(await store.getSecret(a.id), 'tok2');
});
(0, node_test_1.test)('onDidChange listeners can be disposed, and a throwing listener does not break the write or other listeners', async () => {
    const { store } = makeStore();
    let kept = 0;
    let disposed = 0;
    store.onDidChange(() => { throw new Error('bad listener'); });
    store.onDidChange(() => kept++);
    const sub = store.onDidChange(() => disposed++);
    sub.dispose();
    await store.add(octocat);
    node_assert_1.default.strictEqual(kept, 1);
    node_assert_1.default.strictEqual(disposed, 0);
});
(0, node_test_1.test)('two overlapping adds of the same account with a secret store only one and leave no orphan secret', async () => {
    const { store, vault } = makeStore();
    const results = await Promise.allSettled([store.add(octocat, 'tok-a'), store.add(octocat, 'tok-b')]);
    node_assert_1.default.deepStrictEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    node_assert_1.default.strictEqual(store.list().length, 1);
    node_assert_1.default.strictEqual(vault.data.size, 1);
});
(0, node_test_1.test)('add removes its freshly stored secret when the metadata write fails', async () => {
    const { store, meta, vault } = makeStore();
    meta.update = async () => { throw new Error('disk full'); };
    await node_assert_1.default.rejects(store.add(octocat, 'tok'), /disk full/);
    node_assert_1.default.strictEqual(vault.data.size, 0);
});
(0, node_test_1.test)('list skips an entry whose externalId is not a string', async () => {
    const { store, meta } = makeStore();
    const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth', externalId: '42' };
    meta.data.set(accountStore_1.ACCOUNTS_KEY, [good, { ...good, id: 'bad', externalId: 42 }]);
    node_assert_1.default.deepStrictEqual(store.list(), [good]);
});
(0, node_test_1.test)('setSecret fires onDidChangeSecret but not onDidChange; add does the opposite', async () => {
    const { store } = makeStore();
    let secretEvents = 0;
    let changeEvents = 0;
    store.onDidChangeSecret(() => { secretEvents++; });
    store.onDidChange(() => { changeEvents++; });
    const account = await store.add(octocat, 'first');
    node_assert_1.default.deepStrictEqual([secretEvents, changeEvents], [0, 1]);
    await store.setSecret(account.id, 'second');
    node_assert_1.default.deepStrictEqual([secretEvents, changeEvents], [1, 1]);
    await node_assert_1.default.rejects(store.setSecret('missing', 'x'), /No account/);
    node_assert_1.default.strictEqual(secretEvents, 1);
});
//# sourceMappingURL=accountStore.test.js.map