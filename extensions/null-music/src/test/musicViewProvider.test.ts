'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AuthStore } from '../auth/authStore';
import { PlaybackManager } from '../playback/playbackManager';
import { ProviderRegistry } from '../provider/providerRegistry';
import { FakeMusicProvider, FakeSecretVault, makeSamplePlaybackState } from '../testFakes';
import { MusicViewController } from '../ui/musicViewController';

test('MusicViewController handles UI messages and delegates to PlaybackManager', async () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);
  const registry = new ProviderRegistry();
  const fakeProvider = new FakeMusicProvider('spotify');
  fakeProvider.state = makeSamplePlaybackState();
  fakeProvider.playlists = [
    { id: 'p1', name: 'Work Focus', trackCount: 50, uri: 'spotify:playlist:p1', owner: 'Me' },
  ];
  registry.register(fakeProvider);

  const playbackManager = new PlaybackManager({
    providerRegistry: registry,
  });

  const postedMessages: any[] = [];
  const executedCommands: string[] = [];
  const errorMessages: string[] = [];

  const messenger = {
    postMessage: (msg: any) => {
      postedMessages.push(msg);
    },
  };

  const host = {
    executeCommand: async (cmd: string) => {
      executedCommands.push(cmd);
    },
    showErrorMessage: (msg: string) => {
      errorMessages.push(msg);
    },
  };

  const controller = new MusicViewController(playbackManager, authStore, messenger, host);

  // Test message handling
  await controller.handleMessage({ type: 'ready' });
  assert.ok(postedMessages.some((m) => m.type === 'authUpdate' && m.isAuthenticated === true));
  assert.ok(postedMessages.some((m) => m.type === 'stateUpdate'));

  await controller.handleMessage({ type: 'signIn' });
  assert.strictEqual(executedCommands[0], 'null-music.signIn');

  await controller.handleMessage({ type: 'signOut' });
  assert.strictEqual(executedCommands[1], 'null-music.signOut');

  await controller.handleMessage({ type: 'playPause' });
  assert.strictEqual(fakeProvider.state.isPlaying, false);

  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(fakeProvider.state.progressMs, 30000);

  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(fakeProvider.state.volume, 45);

  await controller.handleMessage({ type: 'getPlaylists' });
  assert.ok(postedMessages.some((m) => m.type === 'playlistsUpdate' && m.playlists.length === 1));

  playbackManager.dispose();
});
