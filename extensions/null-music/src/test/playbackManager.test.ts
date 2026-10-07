'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { PlaybackManager } from '../playback/playbackManager';
import { ProviderRegistry } from '../provider/providerRegistry';
import { FakeMusicProvider, makeSamplePlaybackState, makeSampleTrack } from '../testFakes';

test('PlaybackManager refreshes state and fires change events', async () => {
  const registry = new ProviderRegistry();
  const fakeProvider = new FakeMusicProvider('spotify');
  fakeProvider.state = makeSamplePlaybackState({ progressMs: 10000 });
  registry.register(fakeProvider);

  const notifications: string[] = [];
  const manager = new PlaybackManager({
    providerRegistry: registry,
    getPollingIntervalMs: () => 10000,
    onNotification: (msg) => notifications.push(msg),
  });

  const states: any[] = [];
  const tracks: any[] = [];

  manager.onDidChangePlaybackState((s) => states.push(s));
  manager.onDidTrackChange((t) => tracks.push(t));

  await manager.refreshNow();

  assert.ok(states.length >= 1);
  assert.strictEqual(tracks.length, 1);
  assert.strictEqual(tracks[0]?.id, 'track-123');
  assert.strictEqual(notifications.length, 1);
  assert.ok(notifications[0].includes('Lo-Fi Coding Beats'));

  // Controls
  await manager.playPause();
  assert.strictEqual(fakeProvider.state.isPlaying, false);

  await manager.playPause();
  assert.strictEqual(fakeProvider.state.isPlaying, true);

  await manager.seek(25000);
  assert.strictEqual(fakeProvider.state.progressMs, 25000);

  await manager.setVolume(50);
  assert.strictEqual(fakeProvider.state.volume, 50);

  await manager.volumeUp(10);
  assert.strictEqual(fakeProvider.state.volume, 60);

  await manager.volumeDown(20);
  assert.strictEqual(fakeProvider.state.volume, 40);

  await manager.toggleShuffle();
  assert.strictEqual(fakeProvider.state.shuffle, true);

  await manager.toggleRepeat();
  assert.strictEqual(fakeProvider.state.repeat, 'context');

  await manager.toggleRepeat();
  assert.strictEqual(fakeProvider.state.repeat, 'track');

  await manager.toggleRepeat();
  assert.strictEqual(fakeProvider.state.repeat, 'off');

  // Toggle Like
  const liked = await manager.toggleLike();
  assert.strictEqual(liked, true);
  assert.strictEqual(fakeProvider.likedTracks.has('track-123'), true);

  const unliked = await manager.toggleLike();
  assert.strictEqual(unliked, false);
  assert.strictEqual(fakeProvider.likedTracks.has('track-123'), false);

  manager.dispose();
});
