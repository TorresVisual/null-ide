'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { makeSamplePlaybackState } from '../testFakes';
import { buildStatusBarModel, formatTime } from '../ui/statusBarModel';

test('formatTime formats seconds into mm:ss', () => {
  assert.strictEqual(formatTime(0), '0:00');
  assert.strictEqual(formatTime(9), '0:09');
  assert.strictEqual(formatTime(65), '1:05');
  assert.strictEqual(formatTime(600), '10:00');
});

test('buildStatusBarModel returns idle state when no track is playing', () => {
  const model = buildStatusBarModel(null);
  assert.strictEqual(model.text, '$(music) Music');
  assert.strictEqual(model.isPlaying, false);
  assert.ok(model.tooltipText.includes('No active playback'));
});

test('buildStatusBarModel formats playing song and markdown tooltip', () => {
  const state = makeSamplePlaybackState({
    isPlaying: true,
    progressMs: 75000,
    durationMs: 200000,
  });

  const model = buildStatusBarModel(state, '${title} by ${artist}');
  assert.strictEqual(model.text, '$(play) Lo-Fi Coding Beats by Chill Coder');
  assert.strictEqual(model.isPlaying, true);
  assert.ok(model.tooltipText.includes('Lo-Fi Coding Beats'));
  assert.ok(model.tooltipText.includes('Chill Coder'));
  assert.ok(model.tooltipText.includes('Code Vibes Vol. 1'));
  assert.ok(model.tooltipText.includes('1:15 / 3:20'));
  assert.ok(model.tooltipText.includes('MacBook Pro'));
});

test('buildStatusBarModel shows paused icon when paused', () => {
  const state = makeSamplePlaybackState({
    isPlaying: false,
  });

  const model = buildStatusBarModel(state);
  assert.strictEqual(model.text, '$(debug-pause) Lo-Fi Coding Beats - Chill Coder');
  assert.strictEqual(model.isPlaying, false);
});
