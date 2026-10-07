'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getMusicWebviewHtml } from '../ui/musicHtml';

test('getMusicWebviewHtml contains CSP nonce, controls, and clean local elements', () => {
  const nonce = 'test-nonce-12345';
  const html = getMusicWebviewHtml(nonce);

  assert.ok(html.includes(`nonce-${nonce}`));
  assert.ok(html.includes('id="btn-play-pause"'));
  assert.ok(html.includes('id="btn-prev"'));
  assert.ok(html.includes('id="btn-next"'));
  assert.ok(html.includes('id="btn-shuffle"'));
  assert.ok(html.includes('id="btn-repeat"'));
  assert.ok(html.includes('id="btn-like"'));
  assert.ok(html.includes('id="volume-slider"'));
  assert.ok(html.includes('id="progress-bar-container"'));
  assert.ok(html.includes('id="search-input"'));
  assert.ok(html.includes('id="btn-add-folder"'));
  assert.ok(html.includes('id="audio-player"'));
  assert.ok(html.includes('id="pane-tracks"'));
  assert.ok(html.includes('id="pane-playlists"'));
  assert.ok(html.includes('id="pane-folders"'));
  assert.ok(html.includes('id="pane-favorites"'));
  assert.ok(html.includes('id="btn-import-playlist"'));
  assert.ok(html.includes('id="btn-rewind-10"'));
  assert.ok(html.includes('id="btn-forward-10"'));
  assert.ok(html.includes('id="error-banner"'));

  // Ensure slop is completely removed
  assert.ok(!html.includes('Spotify'));
  assert.ok(!html.includes('Lo-Fi Radio'));
  assert.ok(!html.includes('input-client-id'));
  assert.ok(!html.includes('link-dev-dash'));
  assert.ok(!html.includes('select-provider'));
});
