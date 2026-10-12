'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getReportHtml } from '../reportHtml';

test('the shell sets a nonce-only script CSP and loads the bundle', () => {
  const html = getReportHtml('N0NC3', 'vscode-resource:', 'script.js', 'style.css');
  assert.match(html, /script-src 'nonce-N0NC3'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<script nonce="N0NC3" src="script.js">/);
  assert.match(html, /href="style.css"/);
  assert.doesNotMatch(html, /unsafe-inline/);
});
