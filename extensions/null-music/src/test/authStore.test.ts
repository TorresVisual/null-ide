'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AuthStore } from '../auth/authStore';
import { FakeSecretVault } from '../testFakes';
import { MusicAuthToken } from '../types';

test('AuthStore stores, retrieves, and clears tokens', async () => {
  const vault = new FakeSecretVault();
  const store = new AuthStore(vault);

  assert.strictEqual(await store.getToken('spotify'), null);
  assert.strictEqual(await store.hasValidToken('spotify'), false);

  const token: MusicAuthToken = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    tokenType: 'Bearer',
  };

  await store.setToken('spotify', token);
  const retrieved = await store.getToken('spotify');
  assert.deepStrictEqual(retrieved, token);
  assert.strictEqual(await store.hasValidToken('spotify'), true);

  await store.clearToken('spotify');
  assert.strictEqual(await store.getToken('spotify'), null);
  assert.strictEqual(await store.hasValidToken('spotify'), false);
});

test('AuthStore fires onDidChangeAuth event on save and clear', async () => {
  const vault = new FakeSecretVault();
  const store = new AuthStore(vault);
  const events: Array<{ providerId: string; token: MusicAuthToken | null }> = [];

  const sub = store.onDidChangeAuth((providerId, token) => {
    events.push({ providerId, token });
  });

  const token: MusicAuthToken = {
    accessToken: 'abc',
    expiresAt: Date.now() + 10000,
  };

  await store.setToken('spotify', token);
  await store.clearToken('spotify');

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].providerId, 'spotify');
  assert.strictEqual(events[0].token?.accessToken, 'abc');
  assert.strictEqual(events[1].providerId, 'spotify');
  assert.strictEqual(events[1].token, null);

  sub.dispose();
  await store.setToken('spotify', token);
  assert.strictEqual(events.length, 2);
});

test('AuthStore handles corrupt json in vault gracefully', async () => {
  const vault = new FakeSecretVault();
  const store = new AuthStore(vault);

  await vault.store('null-music/token/spotify', 'not-valid-json');
  assert.strictEqual(await store.getToken('spotify'), null);
});
