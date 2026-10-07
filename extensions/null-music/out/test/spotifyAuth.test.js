'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const authStore_1 = require("../auth/authStore");
const spotifyAuth_1 = require("../auth/spotifyAuth");
const testFakes_1 = require("../testFakes");
(0, node_test_1.test)('SpotifyAuth uses custom client ID when set, else default', () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    let customId = '';
    const auth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: () => customId,
        openUrl: async () => { },
    });
    node_assert_1.default.strictEqual(auth.getEffectiveClientId(), spotifyAuth_1.DEFAULT_SPOTIFY_CLIENT_ID);
    customId = 'my-custom-client-id';
    node_assert_1.default.strictEqual(auth.getEffectiveClientId(), 'my-custom-client-id');
});
(0, node_test_1.test)('SpotifyAuth getValidAccessToken returns unexpired token', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    const auth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: () => '',
        openUrl: async () => { },
    });
    node_assert_1.default.strictEqual(await auth.getValidAccessToken(), null);
    node_assert_1.default.strictEqual(await auth.isAuthenticated(), false);
    await authStore.setToken(spotifyAuth_1.SPOTIFY_PROVIDER_ID, {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 300000,
    });
    node_assert_1.default.strictEqual(await auth.getValidAccessToken(), 'valid-token');
    node_assert_1.default.strictEqual(await auth.isAuthenticated(), true);
});
(0, node_test_1.test)('SpotifyAuth getValidAccessToken refreshes token if expired', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    let fetchCalled = false;
    const mockFetch = async (input, init) => {
        fetchCalled = true;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                access_token: 'new-refreshed-token',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'user-read-playback-state',
            }),
            text: async () => '',
        };
    };
    const auth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: () => '',
        openUrl: async () => { },
        fetchFn: mockFetch,
    });
    await authStore.setToken(spotifyAuth_1.SPOTIFY_PROVIDER_ID, {
        accessToken: 'old-expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() - 10000,
    });
    const refreshed = await auth.getValidAccessToken();
    node_assert_1.default.strictEqual(fetchCalled, true);
    node_assert_1.default.strictEqual(refreshed, 'new-refreshed-token');
    const stored = await authStore.getToken(spotifyAuth_1.SPOTIFY_PROVIDER_ID);
    node_assert_1.default.strictEqual(stored?.accessToken, 'new-refreshed-token');
    node_assert_1.default.strictEqual(stored?.refreshToken, 'valid-refresh-token');
});
(0, node_test_1.test)('SpotifyAuth logout clears stored token', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    const auth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: () => '',
        openUrl: async () => { },
    });
    await authStore.setToken(spotifyAuth_1.SPOTIFY_PROVIDER_ID, {
        accessToken: 'tok',
        expiresAt: Date.now() + 100000,
    });
    await auth.logout();
    node_assert_1.default.strictEqual(await auth.isAuthenticated(), false);
    node_assert_1.default.strictEqual(await authStore.getToken(spotifyAuth_1.SPOTIFY_PROVIDER_ID), null);
});
//# sourceMappingURL=spotifyAuth.test.js.map