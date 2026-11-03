import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildHtml, pageFor } from './page';

test('pageFor maps every export kind to a page', () => {
  assert.equal(pageFor('texture'), 'texture');
  assert.equal(pageFor('material'), 'material');
  assert.equal(pageFor('skeletal-mesh'), 'mesh');
  assert.equal(pageFor('material-instance'), 'properties');
  assert.equal(pageFor('skeleton'), 'properties');
  assert.equal(pageFor('generic'), 'properties');
});

test('buildHtml pins the script to a nonce and never allows inline scripts', () => {
  const html = buildHtml({
    page: 'texture',
    nonce: 'abc',
    cspSource: 'https://x.vscode-cdn',
    scriptUri: 'https://x/texture.js',
    styleUri: 'https://x/viewer.css',
    title: 'T',
  });
  assert.match(html, /script-src 'nonce-abc'/);
  assert.match(html, /<script nonce="abc" src="https:\/\/x\/texture\.js">/);
  const scriptSrc = /script-src ([^;]*)/.exec(html)?.[1] ?? '';
  assert.ok(!scriptSrc.includes('unsafe-inline'));
});
