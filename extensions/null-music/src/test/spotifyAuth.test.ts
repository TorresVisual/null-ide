'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AuthStore } from '../auth/authStore';
import { DEFAULT_SPOTIFY_CLIENT_ID, SPOTIFY_PROVIDER_ID, SpotifyAuth } from '../auth/spotifyAuth';
import { FakeSecretVault } from '../testFakes';

test('SpotifyAuth uses custom client ID when set, else default', () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);

  let customId = '';
  const auth = new SpotifyAuth({
    authStore,
    getClientId: () => customId,
    openUrl: async () => {},
  });

  assert.strictEqual(auth.getEffectiveClientId(), DEFAULT_SPOTIFY_CLIENT_ID);

  customId = 'my-custom-client-id';
  assert.strictEqual(auth.getEffectiveClientId(), 'my-custom-client-id');
});

test('SpotifyAuth getValidAccessToken returns unexpired token', async () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);

  const auth = new SpotifyAuth({
    authStore,
    getClientId: () => '',
    openUrl: async () => {},
  });

  assert.strictEqual(await auth.getValidAccessToken(), null);
  assert.strictEqual(await auth.isAuthenticated(), false);

  await authStore.setToken(SPOTIFY_PROVIDER_ID, {
    accessToken: 'valid-token',
    expiresAt: Date.now() + 300000,
  });

  assert.strictEqual(await auth.getValidAccessToken(), 'valid-token');
  assert.strictEqual(await auth.isAuthenticated(), true);
});

test('SpotifyAuth getValidAccessToken refreshes token if expired', async () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);

  let fetchCalled = false;
  const mockFetch: typeof fetch = async (input, init) => {
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
    } as any;
  };

  const auth = new SpotifyAuth({
    authStore,
    getClientId: () => '',
    openUrl: async () => {},
    fetchFn: mockFetch,
  });

  await authStore.setToken(SPOTIFY_PROVIDER_ID, {
    accessToken: 'old-expired-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: Date.now() - 10000,
  });

  const refreshed = await auth.getValidAccessToken();
  assert.strictEqual(fetchCalled, true);
  assert.strictEqual(refreshed, 'new-refreshed-token');

  const stored = await authStore.getToken(SPOTIFY_PROVIDER_ID);
  assert.strictEqual(stored?.accessToken, 'new-refreshed-token');
  assert.strictEqual(stored?.refreshToken, 'valid-refresh-token');
});

test('SpotifyAuth logout clears stored token', async () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);
  const auth = new SpotifyAuth({
    authStore,
    getClientId: () => '',
    openUrl: async () => {},
  });

  await authStore.setToken(SPOTIFY_PROVIDER_ID, {
    accessToken: 'tok',
    expiresAt: Date.now() + 100000,
  });

  await auth.logout();
  assert.strictEqual(await auth.isAuthenticated(), false);
  assert.strictEqual(await authStore.getToken(SPOTIFY_PROVIDER_ID), null);
});
