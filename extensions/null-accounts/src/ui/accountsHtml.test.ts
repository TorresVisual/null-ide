'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { CLIENT_SCRIPT } from './accountsClient';
import { buildHtml } from './accountsHtml';

test('images may only be data URIs', () => {
  assert.match(buildHtml('n'), /img-src data:;/);
});

test('the CSP is nonce-only and the same nonce guards the style and script tags', () => {
  const html = buildHtml('abc123');
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(html, /style-src 'nonce-abc123'/);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /<script nonce="abc123">/);
  assert.match(html, /<style nonce="abc123">/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test('the page has the add button the client script wires up, and embeds the client script', () => {
  const html = buildHtml('n');
  assert.match(html, /id="add-btn"/);
  assert.match(html, /id="list"/);
  assert.ok(html.includes(CLIENT_SCRIPT));
});

test('account and folder text only ever reaches the DOM as text', () => {
  assert.doesNotMatch(CLIENT_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.match(CLIENT_SCRIPT, /textContent/);
});

test('the client script can ask the host to re-authenticate an account', () => {
  assert.match(CLIENT_SCRIPT, /type: 'reauth'/);
});

test('the client script can send every key message the host understands', () => {
  for (const type of ['generateKey', 'attachKey', 'copyPublicKey', 'uploadKey', 'testKey', 'removeKey', 'setSigning']) {
    assert.ok(CLIENT_SCRIPT.includes(`'${type}'`), type);
  }
});
