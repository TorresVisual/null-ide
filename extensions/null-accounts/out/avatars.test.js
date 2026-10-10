'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const avatars_1 = require("./avatars");
const testFakes_1 = require("./testFakes");
const gh = (id, username = id) => ({ id, provider: 'github', host: 'github.com', username, email: 'e@e.com', authMethod: 'oauth' });
const gl = (id, host = 'git.example.org') => ({ id, provider: 'gitlab', host, username: id, email: 'e@e.com', authMethod: 'oauth' });
const PNG = { type: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
function setup(accounts, image = PNG, json = undefined) {
    const list = { current: accounts };
    const urls = [];
    const cache = new avatars_1.AvatarCache({
        meta: new testFakes_1.FakeMeta(),
        accounts: () => list.current,
        getJson: async (url) => { urls.push(url); return json; },
        getImage: async (url) => { urls.push(url); return image ?? undefined; },
    });
    return { cache, list, urls };
}
(0, node_test_1.test)('a GitHub account gets its github.com picture as a data URI, fetched once', async () => {
    const { cache, urls } = setup([gh('a1', 'octo')]);
    await cache.refresh();
    node_assert_1.default.strictEqual(cache.get('a1'), 'data:image/png;base64,AQID');
    node_assert_1.default.deepStrictEqual(urls, ['https://github.com/octo.png?size=64']);
    await cache.refresh();
    node_assert_1.default.strictEqual(urls.length, 1);
});
(0, node_test_1.test)('a GitLab account looks its avatar up on its own host, https only', async () => {
    const { cache, urls } = setup([gl('u')], PNG, [{ avatar_url: 'https://git.example.org/uploads/u.png' }]);
    await cache.refresh();
    node_assert_1.default.ok(cache.get('u'));
    node_assert_1.default.strictEqual(urls[0], 'https://git.example.org/api/v4/users?username=u');
    node_assert_1.default.match(urls[1], /^https:\/\/git\.example\.org\/uploads\/u\.png\?width=64&s=64$/);
    const plain = setup([gl('u')], PNG, [{ avatar_url: 'http://git.example.org/u.png' }]);
    await plain.cache.refresh();
    node_assert_1.default.strictEqual(plain.cache.get('u'), undefined);
});
(0, node_test_1.test)('non-images, oversized or empty replies and failures leave no avatar and are not retried this session', async () => {
    for (const image of [null, { type: 'image/svg+xml', bytes: PNG.bytes }, { type: 'image/png', bytes: new Uint8Array(0) }, { type: 'image/png', bytes: new Uint8Array(200_000) }]) {
        const { cache, urls } = setup([gh('a1')], image);
        await cache.refresh();
        await cache.refresh();
        node_assert_1.default.strictEqual(cache.get('a1'), undefined);
        node_assert_1.default.strictEqual(urls.length, 1);
    }
});
(0, node_test_1.test)('avatars of removed or renamed accounts are dropped, and a change is announced only when something changed', async () => {
    const { cache, list } = setup([gh('a1'), gh('a2')]);
    let fired = 0;
    cache.onDidChange(() => { fired++; });
    await cache.refresh();
    node_assert_1.default.strictEqual(fired, 1);
    await cache.refresh();
    node_assert_1.default.strictEqual(fired, 1);
    list.current = [gh('a1', 'renamed')];
    await cache.refresh();
    node_assert_1.default.strictEqual(cache.get('a2'), undefined);
    node_assert_1.default.ok(cache.get('a1'));
    node_assert_1.default.strictEqual(fired, 2);
});
//# sourceMappingURL=avatars.test.js.map