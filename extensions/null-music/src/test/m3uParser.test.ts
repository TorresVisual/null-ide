'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as path from 'path';
import { parseM3u, serializeM3u } from '../provider/local/m3uParser';

test('m3uParser parses standard M3U8 with EXTINF metadata and relative paths', () => {
  const content = `#EXTM3U
#PLAYLIST:Synthwave Beats
#EXTINF:210,Kavinsky - Nightcall
tracks/nightcall.mp3
#EXTINF:185,Gunship - Tech Noir
../synth/tech_noir.flac
#EXTINF:240,Lazerhawk - Overdrive
Overdrive.ogg
`;

  const playlistPath = 'D:\\Music\\Playlists\\favorites.m3u8';
  const result = parseM3u(content, playlistPath);

  assert.strictEqual(result.name, 'Synthwave Beats');
  assert.strictEqual(result.tracks.length, 3);

  // Track 1
  assert.strictEqual(result.tracks[0].name, 'Nightcall');
  assert.strictEqual(result.tracks[0].artist, 'Kavinsky');
  assert.strictEqual(result.tracks[0].durationMs, 210000);
  assert.ok(result.tracks[0].uri.includes('nightcall.mp3'));

  // Track 2
  assert.strictEqual(result.tracks[1].name, 'Tech Noir');
  assert.strictEqual(result.tracks[1].artist, 'Gunship');
  assert.strictEqual(result.tracks[1].durationMs, 185000);
  assert.ok(result.tracks[1].uri.includes('tech_noir.flac'));

  // Track 3
  assert.strictEqual(result.tracks[2].name, 'Overdrive');
  assert.strictEqual(result.tracks[2].artist, 'Lazerhawk');
  assert.strictEqual(result.tracks[2].durationMs, 240000);
});

test('m3uParser handles UTF-8 BOM, web streams, and absolute paths', () => {
  const bomContent = '\uFEFF' + `#EXTM3U
#EXTINF:-1,SomaFM - Groove Salad
https://ice1.somafm.com/groovesalad-128-mp3
#EXTINF:300,The Midnight - Days of Thunder
C:\\Audio\\Library\\DaysOfThunder.mp3
#EXTINF:150,Simple Track Without Artist
track_only.wav
`;

  const playlistPath = '/home/user/music/chill.m3u8';
  const result = parseM3u(bomContent, playlistPath);

  assert.strictEqual(result.name, 'chill');
  assert.strictEqual(result.tracks.length, 3);

  // Web stream
  assert.strictEqual(result.tracks[0].name, 'Groove Salad');
  assert.strictEqual(result.tracks[0].artist, 'SomaFM');
  assert.strictEqual(result.tracks[0].uri, 'https://ice1.somafm.com/groovesalad-128-mp3');
  assert.strictEqual(result.tracks[0].durationMs, 0);

  // Absolute path
  assert.strictEqual(result.tracks[1].name, 'Days of Thunder');
  assert.strictEqual(result.tracks[1].artist, 'The Midnight');
  assert.strictEqual(result.tracks[1].durationMs, 300000);

  // Title without hyphen
  assert.strictEqual(result.tracks[2].name, 'Simple Track Without Artist');
  assert.strictEqual(result.tracks[2].artist, 'chill');
});

test('serializeM3u correctly formats tracks into M3U8 string', () => {
  const tracks = [
    {
      id: 'local:1',
      name: 'Song A',
      artist: 'Artist 1',
      artists: ['Artist 1'],
      album: 'Test',
      durationMs: 120000,
      uri: 'file:///music/songA.mp3',
    },
  ];

  const m3u = serializeM3u('My Cool Playlist', tracks);
  assert.ok(m3u.includes('#EXTM3U'));
  assert.ok(m3u.includes('#PLAYLIST:My Cool Playlist'));
  assert.ok(m3u.includes('#EXTINF:120,Artist 1 - Song A'));
  assert.ok(m3u.includes('file:///music/songA.mp3'));
});
