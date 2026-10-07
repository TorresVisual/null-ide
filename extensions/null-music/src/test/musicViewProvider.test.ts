'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { PlaybackManager } from '../playback/playbackManager';
import { LocalMusicProvider } from '../provider/local/localProvider';
import { FakeMusicProvider, makeSamplePlaybackState } from '../testFakes';
import { MusicViewController } from '../ui/musicViewController';

test('MusicViewController handles UI messages and delegates to PlaybackManager and LocalProvider', async () => {
  const fakeProvider = new FakeMusicProvider('local');
  fakeProvider.state = makeSamplePlaybackState();

  const playbackManager = new PlaybackManager({
    provider: fakeProvider,
  });

  const localProvider = new LocalMusicProvider();
  localProvider.queueAndPlay([
    {
      id: 'local:file:///music/t1.mp3',
      name: 'Song 1',
      artist: 'Band',
      artists: ['Band'],
      album: 'file:///music',
      durationMs: 100000,
      uri: 'file:///music/t1.mp3',
    },
  ]);

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

  const controller = new MusicViewController(playbackManager, localProvider, messenger, host);

  // Ready message
  await controller.handleMessage({ type: 'ready' });
  assert.ok(postedMessages.some((m) => m.type === 'stateUpdate'));
  assert.ok(postedMessages.some((m) => m.type === 'localLibraryUpdate'));

  // Play / Pause
  await controller.handleMessage({ type: 'playPause' });
  assert.strictEqual(fakeProvider.state.isPlaying, false);

  // Seek
  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(fakeProvider.state.progressMs, 30000);

  // Volume
  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(fakeProvider.state.volume, 45);

  // Add folder
  await controller.handleMessage({ type: 'localOpenFolder' });
  assert.strictEqual(executedCommands[0], 'null-music.openLocalFolder');

  // Toggle track like
  await controller.handleMessage({ type: 'toggleTrackLike', trackId: 'local:file:///music/t1.mp3' });
  assert.strictEqual(await localProvider.isLiked('local:file:///music/t1.mp3'), true);

  // Play track
  await controller.handleMessage({ type: 'localPlayTrack', trackUri: 'file:///music/t1.mp3' });

  // Audio duration update
  await controller.handleMessage({ type: 'localAudioDuration', durationMs: 125000, trackUri: 'file:///music/t1.mp3' });
  assert.strictEqual(localProvider.getAllTracks()[0].durationMs, 125000);

  // Audio ended
  await controller.handleMessage({ type: 'localAudioEnded' });

  // Import Playlist command delegate
  await controller.handleMessage({ type: 'localImportPlaylist' });
  assert.ok(executedCommands.includes('null-music.importPlaylist'));

  // Audio time update
  await controller.handleMessage({ type: 'localAudioTimeUpdate', positionMs: 50000 });
  const pState = await localProvider.getPlaybackState();
  assert.ok(pState && pState.progressMs >= 50000);

  // Playback failed
  await controller.handleMessage({ type: 'localAudioPlayFailed', error: 'Decode failure' });
  assert.strictEqual(errorMessages.some((msg) => msg.includes('Decode failure')), true);
  const failedState = await localProvider.getPlaybackState();
  assert.strictEqual(failedState?.isPlaying, false);

  playbackManager.dispose();
});
