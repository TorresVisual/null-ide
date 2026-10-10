'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getDashboardHtml } from '../dashboardHtml';

const html = getDashboardHtml('NONCE123', 'vscode-resource:', 'dash.js', 'dash.css');

test('the CSP denies everything by default and allows only the nonce\'d script and the extension stylesheet', () => {
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-NONCE123'/);
  assert.match(html, /style-src vscode-resource:/);
  assert.ok(!html.includes('unsafe-inline'));
  assert.ok(!html.includes('unsafe-eval'));
  assert.ok(!/https?:\/\//.test(html), 'no remote resources');
});

test('the page loads the nonce\'d script and the stylesheet and nothing inline', () => {
  assert.match(html, /<script nonce="NONCE123" src="dash\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="dash\.css">/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.strictEqual((html.match(/<script/g) ?? []).length, 1);
});
