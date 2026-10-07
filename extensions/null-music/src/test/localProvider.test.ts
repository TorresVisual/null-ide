'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { LocalMusicProvider } from '../provider/local/localProvider';
import { Track } from '../types';

test('LocalMusicProvider queues tracks and manages playback state', async () => {
  const audioCalls: Array<{ method: string; args: any[] }> = [];
  const adapter = {
    playFile: (uri: string, trackId: string) => audioCalls.push({ method: 'playFile', args: [uri, trackId] }),
    pauseAudio: () => audioCalls.push({ method: 'pauseAudio', args: [] }),
    resumeAudio: () => audioCalls.push({ method: 'resumeAudio', args: [] }),
    seekAudio: (ms: number) => audioCalls.push({ method: 'seekAudio', args: [ms] }),
    setVolume: (vol: number) => audioCalls.push({ method: 'setVolume', args: [vol] }),
  };

  const provider = new LocalMusicProvider(adapter);

  const sampleTracks: Track[] = [
    {
      id: 'local:file:///music/song1.mp3',
      name: 'Track One',
      artist: 'Artist A',
      artists: ['Artist A'],
      album: 'file:///music',
      durationMs: 120000,
      uri: 'file:///music/song1.mp3',
    },
    {
      id: 'local:file:///music/song2.mp3',
      name: 'Track Two',
      artist: 'Artist B',
      artists: ['Artist B'],
      album: 'file:///music',
      durationMs: 180000,
      uri: 'file:///music/song2.mp3',
    },
  ];

  provider.queueAndPlay(sampleTracks, 0);

  let state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, true);
  assert.strictEqual(state?.track?.name, 'Track One');
  assert.strictEqual(audioCalls[0].method, 'playFile');
  assert.strictEqual(audioCalls[0].args[0], 'file:///music/song1.mp3');

  // Pause
  await provider.pause();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, false);
  assert.strictEqual(audioCalls[1].method, 'pauseAudio');

  // Resume
  await provider.play();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, true);
  assert.strictEqual(audioCalls[2].method, 'resumeAudio');

  // Next track
  await provider.next();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.track?.name, 'Track Two');

  // Previous track
  await provider.previous();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.track?.name, 'Track One');

  // Seek
  await provider.seek(15000);
  state = await provider.getPlaybackState();
  assert.ok(state && state.progressMs >= 15000);
  assert.strictEqual(audioCalls.some((c) => c.method === 'seekAudio' && c.args[0] === 15000), true);

  // Volume
  await provider.setVolume(70);
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.volume, 70);
  assert.strictEqual(audioCalls.some((c) => c.method === 'setVolume' && c.args[0] === 70), true);

  // Liking
  assert.strictEqual(await provider.isLiked('local:file:///music/song1.mp3'), false);
  await provider.saveTrack('local:file:///music/song1.mp3');
  assert.strictEqual(await provider.isLiked('local:file:///music/song1.mp3'), true);
  await provider.removeTrack('local:file:///music/song1.mp3');
  assert.strictEqual(await provider.isLiked('local:file:///music/song1.mp3'), false);

  // Search
  const searchResults = await provider.search('Track Two');
  assert.strictEqual(searchResults.tracks.length, 1);
  assert.strictEqual(searchResults.tracks[0].name, 'Track Two');

  // Repeat and End of Track handling
  await provider.setRepeatMode('track');
  await provider.notifyEnded();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.track?.name, 'Track One');
});

test('LocalMusicProvider scans directory and manages folders', async () => {
  const fakeFiles: Record<string, Array<[string, number]>> = {
    'file:///d:/Music': [
      ['01 - Daft Punk - One More Time.mp3', 1],
      ['song2.flac', 1],
      ['ignored.txt', 1],
    ],
  };

  const provider = new LocalMusicProvider({
    directoryReader: async (uri) => {
      const uriStr = uri.toString();
      return fakeFiles[uriStr] || [];
    },
  });

  const tracks = await provider.addFolder('file:///d:/Music');
  assert.strictEqual(tracks.length, 2);
  assert.strictEqual(tracks[0].name, 'One More Time');
  assert.strictEqual(tracks[0].artist, 'Daft Punk');
  assert.strictEqual(tracks[1].name, 'song2');

  const allTracks = provider.getAllTracks();
  assert.strictEqual(allTracks.length, 2);

  // Playlists check
  await provider.saveTrack(tracks[0].id);
  const playlists = await provider.getUserPlaylists();
  assert.strictEqual(playlists.length, 2); // Favorites + Folder
  assert.strictEqual(playlists[0].name, 'Liked Tracks');
  assert.strictEqual(playlists[1].name, 'Music');

  // Remove folder
  await provider.removeFolder('file:///d:/Music');
  assert.strictEqual(provider.getAllTracks().length, 0);
  assert.strictEqual(provider.getFolderUris().length, 0);
});

test('LocalMusicProvider imports and plays .m3u8 playlists', async () => {
  const audioCalls: Array<{ method: string; args: any[] }> = [];
  const adapter = {
    playFile: (uri: string, trackId: string) => audioCalls.push({ method: 'playFile', args: [uri, trackId] }),
    pauseAudio: () => audioCalls.push({ method: 'pauseAudio', args: [] }),
    resumeAudio: () => audioCalls.push({ method: 'resumeAudio', args: [] }),
    seekAudio: (ms: number) => audioCalls.push({ method: 'seekAudio', args: [ms] }),
    setVolume: (vol: number) => audioCalls.push({ method: 'setVolume', args: [vol] }),
  };

  const provider = new LocalMusicProvider(adapter);

  const m3uContent = `#EXTM3U
#PLAYLIST:Coding Beats
#EXTINF:200,Lofi Girl - Study Session
study.mp3
#EXTINF:250,Chillhop - Coffee Break
coffee.mp3
`;

  const playlist = await provider.importPlaylist('D:\\Music\\coding.m3u8', m3uContent);
  assert.strictEqual(playlist.name, 'Coding Beats');
  assert.strictEqual(playlist.tracks.length, 2);

  // Check playlists list
  const playlists = await provider.getUserPlaylists();
  assert.strictEqual(playlists.length, 1);
  assert.strictEqual(playlists[0].name, 'Coding Beats');
  assert.strictEqual(playlists[0].trackCount, 2);

  // Play playlist via contextUri
  await provider.play({ contextUri: `local:playlist:${encodeURIComponent(playlist.id)}` });
  let state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, true);
  assert.strictEqual(state?.track?.name, 'Study Session');
  assert.strictEqual(audioCalls[0].method, 'playFile');

  // Next track in playlist
  await provider.next();
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.track?.name, 'Coffee Break');

  // Audio time synchronization
  provider.notifyTimeUpdate(45000);
  state = await provider.getPlaybackState();
  assert.ok(state && state.progressMs >= 45000);

  // Playback failure notification sets isPlaying to false
  provider.notifyPlaybackFailed('Codec error');
  state = await provider.getPlaybackState();
  assert.strictEqual(state?.isPlaying, false);

  // Remove playlist
  await provider.removePlaylist(playlist.id);
  const afterRemove = await provider.getUserPlaylists();
  assert.strictEqual(afterRemove.length, 0);
});
