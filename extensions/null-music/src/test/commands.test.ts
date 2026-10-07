'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { formatSec, NULL_MUSIC_COMMANDS, parseTimeToMs } from '../ui/commandHelpers';

test('formatSec formats seconds to mm:ss', () => {
  assert.strictEqual(formatSec(0), '0:00');
  assert.strictEqual(formatSec(5), '0:05');
  assert.strictEqual(formatSec(65), '1:05');
  assert.strictEqual(formatSec(125), '2:05');
  assert.strictEqual(formatSec(3600), '60:00');
});

test('parseTimeToMs parses seconds, mm:ss, and rejects invalid formats', () => {
  assert.strictEqual(parseTimeToMs('45'), 45000);
  assert.strictEqual(parseTimeToMs('120'), 120000);
  assert.strictEqual(parseTimeToMs('1:30'), 90000);
  assert.strictEqual(parseTimeToMs('0:45'), 45000);
  assert.strictEqual(parseTimeToMs('3:00'), 180000);
  assert.strictEqual(parseTimeToMs('invalid'), null);
  assert.strictEqual(parseTimeToMs('1:99'), null);
  assert.strictEqual(parseTimeToMs('-10'), null);
});

test('NULL_MUSIC_COMMANDS includes all essential local playback and folder commands', () => {
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.playPause'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.nextTrack'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.previousTrack'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.seek'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.setVolume'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.volumeUp'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.volumeDown'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.toggleShuffle'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.toggleRepeat'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.likeCurrentTrack'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.search'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.browsePlaylists'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.openLocalFolder'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.importPlaylist'));
  assert.ok(NULL_MUSIC_COMMANDS.includes('null-music.focus'));
  assert.strictEqual(NULL_MUSIC_COMMANDS.length, 18);
});
