'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getMusicWebviewHtml } from '../ui/musicHtml';

test('getMusicWebviewHtml contains CSP nonce, controls, and elements', () => {
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
  assert.ok(html.includes('id="playlists-list"'));
  assert.ok(html.includes('id="search-input"'));
  assert.ok(html.includes('id="devices-list"'));
});
