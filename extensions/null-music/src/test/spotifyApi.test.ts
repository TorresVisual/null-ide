'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { SpotifyApi } from '../provider/spotify/spotifyApi';

test('SpotifyApi throws if not authenticated', async () => {
  const api = new SpotifyApi({
    getAccessToken: async () => null,
  });

  await assert.rejects(api.getPlaybackState(), /not authenticated/i);
});

test('SpotifyApi getPlaybackState parses response correctly', async () => {
  const mockResponse = {
    is_playing: true,
    progress_ms: 12000,
    shuffle_state: true,
    repeat_state: 'track',
    timestamp: 1600000000000,
    device: {
      id: 'd1',
      name: 'Null Speaker',
      type: 'Speaker',
      is_active: true,
      volume_percent: 75,
    },
    item: {
      id: 'song-1',
      name: 'Coding Flow',
      duration_ms: 240000,
      uri: 'spotify:track:song-1',
      album: {
        name: 'Focus Album',
        images: [{ url: 'https://example.com/cover.jpg' }],
      },
      artists: [{ name: 'Null Artist' }, { name: 'Featuring Pro' }],
    },
  };

  const mockFetch: typeof fetch = async (url, init) => {
    return {
      status: 200,
      ok: true,
      json: async () => mockResponse,
      text: async () => '',
    } as any;
  };

  const api = new SpotifyApi({
    getAccessToken: async () => 'fake-access-token',
    fetchFn: mockFetch,
  });

  const state = await api.getPlaybackState();
  assert.ok(state !== null);
  assert.strictEqual(state.isPlaying, true);
  assert.strictEqual(state.progressMs, 12000);
  assert.strictEqual(state.durationMs, 240000);
  assert.strictEqual(state.volume, 75);
  assert.strictEqual(state.shuffle, true);
  assert.strictEqual(state.repeat, 'track');
  assert.strictEqual(state.track?.id, 'song-1');
  assert.strictEqual(state.track?.name, 'Coding Flow');
  assert.strictEqual(state.track?.artist, 'Null Artist, Featuring Pro');
  assert.strictEqual(state.track?.album, 'Focus Album');
  assert.strictEqual(state.track?.albumArtUrl, 'https://example.com/cover.jpg');
  assert.strictEqual(state.device?.name, 'Null Speaker');
});

test('SpotifyApi playback control methods send correct endpoints and bodies', async () => {
  const requests: Array<{ url: string; method: string; body?: any }> = [];

  const mockFetch: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      status: 204,
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as any;
  };

  const api = new SpotifyApi({
    getAccessToken: async () => 'tok',
    fetchFn: mockFetch,
  });

  await api.play({ uri: 'spotify:track:123' });
  await api.pause();
  await api.next();
  await api.previous();
  await api.seek(50000);
  await api.setVolume(60);
  await api.setShuffle(true);
  await api.setRepeatMode('context');

  assert.strictEqual(requests.length, 8);
  assert.strictEqual(requests[0].method, 'PUT');
  assert.ok(requests[0].url.includes('/player/play'));
  assert.deepStrictEqual(requests[0].body, { uris: ['spotify:track:123'] });

  assert.strictEqual(requests[1].method, 'PUT');
  assert.ok(requests[1].url.includes('/player/pause'));

  assert.strictEqual(requests[2].method, 'POST');
  assert.ok(requests[2].url.includes('/player/next'));

  assert.strictEqual(requests[3].method, 'POST');
  assert.ok(requests[3].url.includes('/player/previous'));

  assert.strictEqual(requests[4].method, 'PUT');
  assert.ok(requests[4].url.includes('position_ms=50000'));

  assert.strictEqual(requests[5].method, 'PUT');
  assert.ok(requests[5].url.includes('volume_percent=60'));

  assert.strictEqual(requests[6].method, 'PUT');
  assert.ok(requests[6].url.includes('state=true'));

  assert.strictEqual(requests[7].method, 'PUT');
  assert.ok(requests[7].url.includes('state=context'));
});

test('SpotifyApi search normalizes songs, playlists, artists, and albums', async () => {
  const mockSearchData = {
    tracks: {
      items: [
        {
          id: 't1',
          name: 'Song A',
          type: 'track',
          duration_ms: 180000,
          uri: 'spotify:track:t1',
          album: { name: 'Album A', images: [{ url: 'http://img.com/a.jpg' }] },
          artists: [{ name: 'Artist A' }],
        },
      ],
    },
    playlists: {
      items: [
        {
          id: 'p1',
          name: 'Coding Lo-Fi',
          description: 'Best beats',
          images: [{ url: 'http://img.com/p.jpg' }],
          tracks: { total: 42 },
          uri: 'spotify:playlist:p1',
          owner: { display_name: 'Spotify' },
        },
      ],
    },
    artists: {
      items: [{ id: 'art1', name: 'Chill Coder', uri: 'spotify:artist:art1', images: [] }],
    },
    albums: {
      items: [{ id: 'alb1', name: 'Synth Album', uri: 'spotify:album:alb1', total_tracks: 10, artists: [{ name: 'Synth' }], images: [] }],
    },
  };

  const mockFetch: typeof fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => mockSearchData,
    text: async () => '',
  } as any);

  const api = new SpotifyApi({
    getAccessToken: async () => 'tok',
    fetchFn: mockFetch,
  });

  const results = await api.search('chill');
  assert.strictEqual(results.tracks.length, 1);
  assert.strictEqual(results.tracks[0].name, 'Song A');
  assert.strictEqual(results.playlists.length, 1);
  assert.strictEqual(results.playlists[0].name, 'Coding Lo-Fi');
  assert.strictEqual(results.artists.length, 1);
  assert.strictEqual(results.artists[0].name, 'Chill Coder');
  assert.strictEqual(results.albums.length, 1);
  assert.strictEqual(results.albums[0].name, 'Synth Album');
});
