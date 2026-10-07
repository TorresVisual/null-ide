'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { LofiProvider, StreamAudioAdapter } from '../provider/lofi/lofiProvider';
import { LOFI_STATIONS } from '../provider/lofi/stations';

test('LofiProvider initialization and free authentication', async () => {
  const provider = new LofiProvider();
  assert.strictEqual(provider.id, 'lofi');
  assert.strictEqual(provider.displayName, 'Null Lo-Fi Radio');

  assert.strictEqual(await provider.isAuthenticated(), true);
  assert.strictEqual(await provider.authenticate(), true);

  const user = await provider.getCurrentUser();
  assert.ok(user);
  assert.strictEqual(user.id, 'null-coder');
  assert.strictEqual(user.product, 'free-stream');
});

test('LofiProvider playback state, stations and audio adapter controls', async () => {
  const playedUrls: string[] = [];
  let paused = false;
  let currentVol = 0;

  const audioAdapter: StreamAudioAdapter = {
    playStream: (url: string) => {
      playedUrls.push(url);
      paused = false;
    },
    pauseStream: () => {
      paused = true;
    },
    setVolume: (vol: number) => {
      currentVol = vol;
    },
  };

  const provider = new LofiProvider(audioAdapter);

  // Initial playback state
  const state0 = await provider.getPlaybackState();
  assert.ok(state0);
  assert.strictEqual(state0.isPlaying, false);
  assert.strictEqual(state0.track?.id, LOFI_STATIONS[0].id);

  // Play
  await provider.play();
  assert.strictEqual(playedUrls.length, 1);
  assert.strictEqual(playedUrls[0], LOFI_STATIONS[0].streamUrl);

  const statePlaying = await provider.getPlaybackState();
  assert.strictEqual(statePlaying?.isPlaying, true);

  // Pause
  await provider.pause();
  assert.strictEqual(paused, true);

  // Next station
  await provider.play();
  await provider.next();
  const stateNext = await provider.getPlaybackState();
  assert.strictEqual(stateNext?.track?.id, LOFI_STATIONS[1].id);

  // Previous station
  await provider.previous();
  const statePrev = await provider.getPlaybackState();
  assert.strictEqual(statePrev?.track?.id, LOFI_STATIONS[0].id);

  // Volume
  await provider.setVolume(65);
  assert.strictEqual(currentVol, 65);
  const stateVol = await provider.getPlaybackState();
  assert.strictEqual(stateVol?.volume, 65);
});

test('LofiProvider playlists and search', async () => {
  const provider = new LofiProvider();

  const playlists = await provider.getUserPlaylists();
  assert.strictEqual(playlists.length, LOFI_STATIONS.length);
  assert.strictEqual(playlists[0].name, LOFI_STATIONS[0].name);

  const tracks = await provider.getPlaylistTracks(LOFI_STATIONS[0].id);
  assert.strictEqual(tracks.length, 1);
  assert.strictEqual(tracks[0].id, LOFI_STATIONS[0].id);

  const emptyTracks = await provider.getPlaylistTracks('non-existent');
  assert.strictEqual(emptyTracks.length, 0);

  const searchResults = await provider.search('Synthwave');
  assert.ok(searchResults.tracks.length >= 1);
  assert.strictEqual(searchResults.tracks[0].id, 'synthwave');
});

test('LofiProvider likes management', async () => {
  const provider = new LofiProvider();
  const stationId = LOFI_STATIONS[0].id;

  assert.strictEqual(await provider.isLiked(stationId), false);
  await provider.saveTrack(stationId);
  assert.strictEqual(await provider.isLiked(stationId), true);

  const state = await provider.getPlaybackState();
  assert.strictEqual(state?.track?.isLiked, true);

  await provider.removeTrack(stationId);
  assert.strictEqual(await provider.isLiked(stationId), false);
});
