'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const authStore_1 = require("../auth/authStore");
const testFakes_1 = require("../testFakes");
(0, node_test_1.test)('AuthStore stores, retrieves, and clears tokens', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const store = new authStore_1.AuthStore(vault);
    node_assert_1.default.strictEqual(await store.getToken('spotify'), null);
    node_assert_1.default.strictEqual(await store.hasValidToken('spotify'), false);
    const token = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
    };
    await store.setToken('spotify', token);
    const retrieved = await store.getToken('spotify');
    node_assert_1.default.deepStrictEqual(retrieved, token);
    node_assert_1.default.strictEqual(await store.hasValidToken('spotify'), true);
    await store.clearToken('spotify');
    node_assert_1.default.strictEqual(await store.getToken('spotify'), null);
    node_assert_1.default.strictEqual(await store.hasValidToken('spotify'), false);
});
(0, node_test_1.test)('AuthStore fires onDidChangeAuth event on save and clear', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const store = new authStore_1.AuthStore(vault);
    const events = [];
    const sub = store.onDidChangeAuth((providerId, token) => {
        events.push({ providerId, token });
    });
    const token = {
        accessToken: 'abc',
        expiresAt: Date.now() + 10000,
    };
    await store.setToken('spotify', token);
    await store.clearToken('spotify');
    node_assert_1.default.strictEqual(events.length, 2);
    node_assert_1.default.strictEqual(events[0].providerId, 'spotify');
    node_assert_1.default.strictEqual(events[0].token?.accessToken, 'abc');
    node_assert_1.default.strictEqual(events[1].providerId, 'spotify');
    node_assert_1.default.strictEqual(events[1].token, null);
    sub.dispose();
    await store.setToken('spotify', token);
    node_assert_1.default.strictEqual(events.length, 2);
});
(0, node_test_1.test)('AuthStore handles corrupt json in vault gracefully', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const store = new authStore_1.AuthStore(vault);
    await vault.store('null-music/token/spotify', 'not-valid-json');
    node_assert_1.default.strictEqual(await store.getToken('spotify'), null);
});
//# sourceMappingURL=authStore.test.js.map