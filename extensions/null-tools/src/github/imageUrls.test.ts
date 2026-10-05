'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  cacheFileName, cacheFileNames, cacheKeyUrl, extractImageUrls, imageExtension, imageFetchPlan, tokenForUrl,
} from './imageUrls';

const SIGNED = 'https://private-user-images.githubusercontent.com/91338024/659308528-2aaf4603-a019-489f-82f2-9a57c6854c55.png';

test('extractImageUrls decodes entities (signed URLs carry &amp;), skips emoji and repeats, ignores data-canonical-src', () => {
  const html = `<p><a href="x"><img width="10" alt="Image" src="${SIGNED}?jwt=a.b&amp;x=1" class="js-gh-image-fallback"></a>`
    + '<img class="emoji" alt="👍" src="https://github.githubassets.com/e.png">'
    + `<img src="${SIGNED}?jwt=a.b&amp;x=1">`
    + '<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc"></p>';
  assert.deepStrictEqual(extractImageUrls(html), [`${SIGNED}?jwt=a.b&x=1`, 'https://camo.githubusercontent.com/abc']);
});

test('extractImageUrls decodes one level only and finds nothing in markup without images', () => {
  assert.deepStrictEqual(extractImageUrls('<img src="https://x/a?q=&amp;lt;">'), ['https://x/a?q=&lt;']);
  assert.deepStrictEqual(extractImageUrls('<p>no pictures, just <code>&lt;img&gt;</code></p>'), []);
  assert.deepStrictEqual(extractImageUrls(''), []);
});

test('imageExtension trusts a real image content type, and falls back to the file name for GitHub raw answers', () => {
  assert.strictEqual(imageExtension('image/png', 'https://x/y'), 'png');
  assert.strictEqual(imageExtension('image/jpeg; charset=x', 'https://x/y'), 'jpg');
  assert.strictEqual(imageExtension('image/svg+xml', 'https://x/y'), 'svg');
  assert.strictEqual(
    imageExtension('application/vnd.github.raw+json; charset=utf-8', 'https://github.com/o/r/blob/b/2026/10/a.PNG?raw=true'), 'png');
  assert.strictEqual(imageExtension(null, 'https://x/a.jpeg'), 'jpg');
  assert.strictEqual(imageExtension('application/octet-stream', 'https://x/a.webp'), 'webp');
});

test('imageExtension refuses what is not a stored image type: HTML error pages, other images, unknown names', () => {
  assert.strictEqual(imageExtension('text/html; charset=utf-8', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension('application/json', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension('image/tiff', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.exe'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.png.exe'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.constructor'), null);
  assert.strictEqual(imageExtension(null, 'https://x/noextension'), null);
  assert.strictEqual(imageExtension(null, 'not a url'), null);
});

test('cacheKeyUrl ignores the jwt GitHub re-signs private images with, but nothing else', () => {
  assert.strictEqual(cacheKeyUrl(`${SIGNED}?jwt=AAA`), cacheKeyUrl(`${SIGNED}?jwt=BBB&x=1`));
  assert.notStrictEqual(cacheKeyUrl('https://camo.githubusercontent.com/a'), cacheKeyUrl('https://camo.githubusercontent.com/b'));
  assert.notStrictEqual(cacheKeyUrl('https://example.com/i?id=1'), cacheKeyUrl('https://example.com/i?id=2'));
  assert.strictEqual(cacheKeyUrl('not a url'), 'not a url');
});

test('cache file names are stable, flat, and cover every stored type', () => {
  const names = cacheFileNames(`${SIGNED}?jwt=AAA`);
  assert.strictEqual(names.length, 5);
  assert.ok(names.includes(cacheFileName(`${SIGNED}?jwt=BBB`, 'png')));
  for (const name of names) assert.match(name, /^[0-9a-f]{40}\.(png|jpg|gif|webp|svg)$/);
});

test('imageFetchPlan sends repo file links through the Contents API and everything else straight out', () => {
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/TorresVisual/null-ide/blob/null-issue-assets/2026/10/a%20b.png?raw=true'),
    { kind: 'contents', owner: 'TorresVisual', repo: 'null-ide', ref: 'null-issue-assets', path: '2026/10/a b.png' });
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/o/r/raw/main/x.png'), { kind: 'contents', owner: 'o', repo: 'r', ref: 'main', path: 'x.png' });
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/user-attachments/assets/2aaf4603'),
    { kind: 'direct', url: 'https://github.com/user-attachments/assets/2aaf4603' });
  assert.deepStrictEqual(imageFetchPlan(`${SIGNED}?jwt=a`), { kind: 'direct', url: `${SIGNED}?jwt=a` });
});

test('imageFetchPlan refuses non-https URLs, other schemes and garbage, without throwing', () => {
  for (const url of ['http://github.com/a.png', 'file:///C:/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'nope', '']) {
    assert.strictEqual(imageFetchPlan(url), null, url);
  }
  assert.strictEqual(imageFetchPlan('https://github.com/o/r/blob/main/%zz.png'), null);
});

test('tokenForUrl gives the token to GitHub itself on the first request only', () => {
  assert.strictEqual(tokenForUrl('https://github.com/user-attachments/assets/1', 't', 0), 't');
  assert.strictEqual(tokenForUrl('https://api.github.com/repos/o/r/contents/a.png', 't', 0), 't');
  assert.strictEqual(tokenForUrl('https://github.com/user-attachments/assets/1', 't', 1), null); // a redirect hop
  assert.strictEqual(tokenForUrl('https://private-user-images.githubusercontent.com/1/2.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://camo.githubusercontent.com/abc', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com.evil.example/a.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com@evil.example/a.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://evil.example/?github.com', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com/a.png', null, 0), null);
  assert.strictEqual(tokenForUrl('nope', 't', 0), null);
});
