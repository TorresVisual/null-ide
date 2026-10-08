'use strict';

import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getMusicWebviewHtml } from '../ui/musicHtml';

test('the shell sets a strict CSP, links the bundle and carries no inline script or style', () => {
  const html = getMusicWebviewHtml('test-nonce', 'vscode-webview-resource:', 'vscode:music.js', 'vscode:music.css');
  assert.ok(html.includes("script-src 'nonce-test-nonce'"));
  assert.ok(html.includes('<script nonce="test-nonce" src="vscode:music.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="vscode:music.css">'));
  assert.ok(html.includes('id="app"'));
  assert.ok(!html.includes("'unsafe-inline'"));
  assert.ok(!html.includes('<style'));
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline <script>');
  assert.ok(html.split('\n').length < 40, 'the shell stays tiny');
});

test('the compiled bundle keeps the engine audio protocol and the AbortError filter', () => {
  const bundle = path.join(__dirname, '..', '..', 'lib', 'music.js');
  assert.ok(existsSync(bundle), 'run `npm run compile` first');
  const js = readFileSync(bundle, 'utf8');
  for (const message of ['localLoad', 'localPause', 'localResume', 'localSeek', 'localVolume', 'localAudioPlayStarted', 'localAudioEnded']) {
    assert.ok(js.includes(`'${message}'`), `bundle handles ${message}`);
  }
  assert.ok(js.includes("err.name === 'AbortError'"), 'an interrupted play() must not count as a failure');
});
