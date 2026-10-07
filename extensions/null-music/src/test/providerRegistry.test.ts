'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { ProviderRegistry } from '../provider/providerRegistry';
import { FakeMusicProvider } from '../testFakes';

test('ProviderRegistry registers, retrieves, and switches active providers', () => {
  const registry = new ProviderRegistry();

  const spotify = new FakeMusicProvider('spotify', 'Spotify');
  const apple = new FakeMusicProvider('apple', 'Apple Music');

  let activeChangeCount = 0;
  registry.onDidChangeActiveProvider(() => {
    activeChangeCount++;
  });

  const regSpotify = registry.register(spotify);
  assert.strictEqual(registry.getActiveProvider()?.id, 'spotify');
  assert.strictEqual(activeChangeCount, 1);

  registry.register(apple);
  assert.strictEqual(registry.getAll().length, 2);

  registry.setActiveProviderId('apple');
  assert.strictEqual(registry.getActiveProvider()?.id, 'apple');
  assert.strictEqual(activeChangeCount, 2);

  regSpotify.dispose();
  assert.strictEqual(registry.get('spotify'), undefined);
  assert.strictEqual(registry.getAll().length, 1);
});
