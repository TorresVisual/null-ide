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
  assert.strictEqual(model.text, '$(play) Ambient Coding by Null Artist');
  assert.strictEqual(model.isPlaying, true);
  assert.ok(model.tooltipText.includes('Ambient Coding'));
  assert.ok(model.tooltipText.includes('Null Artist'));
  assert.ok(model.tooltipText.includes('1:15 / 3:20'));
});

test('buildStatusBarModel shows paused icon when paused', () => {
  const state = makeSamplePlaybackState({
    isPlaying: false,
  });

  const model = buildStatusBarModel(state);
  assert.strictEqual(model.text, '$(debug-pause) Ambient Coding - Null Artist');
  assert.strictEqual(model.isPlaying, false);
});
