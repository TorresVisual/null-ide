'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AuthStore } from '../auth/authStore';
import { SpotifyAuth } from '../auth/spotifyAuth';
import { SpotifyApi } from '../provider/spotify/spotifyApi';
import { SpotifyProvider } from '../provider/spotify/spotifyProvider';
import { FakeSecretVault } from '../testFakes';

test('SpotifyProvider delegates correctly to SpotifyAuth and SpotifyApi', async () => {
  const vault = new FakeSecretVault();
  const authStore = new AuthStore(vault);
  const auth = new SpotifyAuth({
    authStore,
    getClientId: () => '',
    openUrl: async () => {},
  });

  let playCalledWith: any = null;
  const mockApi = {
    getCurrentUser: async () => ({ id: 'u1', name: 'Dev' }),
    getPlaybackState: async () => ({
      isPlaying: true,
      track: { id: 't1', name: 'Track 1' },
      progressMs: 0,
      durationMs: 1000,
      volume: 100,
      shuffle: false,
      repeat: 'off',
      timestamp: Date.now(),
    }),
    isLiked: async (id: string) => id === 't1',
    play: async (opt: any) => { playCalledWith = opt; },
    pause: async () => {},
    next: async () => {},
    previous: async () => {},
    seek: async () => {},
    setVolume: async () => {},
    setShuffle: async () => {},
    setRepeatMode: async () => {},
    getUserPlaylists: async () => [],
    getPlaylistTracks: async () => [],
    search: async () => ({ tracks: [], playlists: [], artists: [], albums: [] }),
    saveTrack: async () => {},
    removeTrack: async () => {},
    getDevices: async () => [],
    transferPlayback: async () => {},
  } as unknown as SpotifyApi;

  const provider = new SpotifyProvider(auth, mockApi);

  assert.strictEqual(provider.id, 'spotify');
  assert.strictEqual(provider.displayName, 'Spotify');

  const user = await provider.getCurrentUser();
  assert.strictEqual(user?.name, 'Dev');

  const state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, true);
  assert.strictEqual(state?.track?.isLiked, true);

  await provider.play({ uri: 'spotify:track:abc' });
  assert.deepStrictEqual(playCalledWith, { uri: 'spotify:track:abc' });
});
