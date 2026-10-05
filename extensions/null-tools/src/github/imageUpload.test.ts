'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { MAX_IMAGE_BYTES } from './imageUrls';
import { ASSET_BRANCH, UploadApi, UploadRejected, checkUpload, imageMarkdown, uploadImage, uploadPath } from './imageUpload';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const file = (name = 'image.png') => ({ name, mime: 'image/png', bytes: PNG });

/**
 * A GitHub stand-in. uploadImage remembers which repos' assets branch exists, across calls, so every test below
 * uses its own repo name.
 */
function fakeApi(over: Partial<UploadApi> = {}) {
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  let branch = false;
  const api: UploadApi = {
    getRefSha: async () => { log.push('get'); return branch ? 'sha' : null; },
    createOrphanBranch: async () => { log.push('create'); await tick(); branch = true; },
    putFile: async (_owner, _repo, _branch, filePath) => {
      log.push(`put ${filePath}`);
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    },
    ...over,
  };
  return { api, log, peak: () => peak };
}

test('uploadPath is yyyy/mm/<uuid>.<ext> in UTC', () => {
  assert.strictEqual(uploadPath(new Date('2026-10-05T23:59:00Z'), 'abc', 'png'), '2026/10/abc.png');
  assert.strictEqual(uploadPath(new Date('2026-03-01T00:00:00Z'), 'abc', 'webp'), '2026/03/abc.webp');
});

test('imageMarkdown links the file on the assets branch with ?raw=true and keeps the alt text from breaking the syntax', () => {
  const repo = { owner: 'o', repo: 'r' };
  assert.strictEqual(
    imageMarkdown(repo, '2026/10/u.png', 'Screen Shot.png'),
    `![Screen Shot](https://github.com/o/r/blob/${ASSET_BRANCH}/2026/10/u.png?raw=true)`);
  assert.ok(imageMarkdown(repo, 'p.png', 'a]b[c.png').startsWith('![a b c]('));
  assert.ok(imageMarkdown(repo, 'p.png', '.png').startsWith('![image]('));
});

test('checkUpload accepts the five image types and names the problem otherwise', () => {
  assert.deepStrictEqual(checkUpload('a.png', 'image/png', 10), { ext: 'png' });
  assert.deepStrictEqual(checkUpload('a.jpeg', 'image/jpeg', 10), { ext: 'jpg' });
  assert.deepStrictEqual(checkUpload('a.webp', '', 10), { ext: 'webp' }); // a dropped file can have no MIME type
  assert.match((checkUpload('a.tiff', 'image/tiff', 10) as { error: string }).error, /PNG, JPG, GIF, WebP and SVG/);
  assert.match((checkUpload('a.png.exe', 'application/octet-stream', 10) as { error: string }).error, /PNG, JPG/);
  assert.match((checkUpload('a.png', 'image/png', 0) as { error: string }).error, /empty/);
  assert.match((checkUpload('a.png', 'image/png', MAX_IMAGE_BYTES + 1) as { error: string }).error, /10 MB/);
});

test('three parallel uploads create the assets branch once and commit one at a time', async () => {
  const net = fakeApi();
  const markdown = await Promise.all([1, 2, 3].map(() => uploadImage({ owner: 'o', repo: 'parallel' }, 't', file(), net.api)));
  assert.strictEqual(net.log.filter(l => l === 'create').length, 1);
  assert.strictEqual(net.log.filter(l => l.startsWith('put ')).length, 3);
  assert.strictEqual(net.peak(), 1);
  assert.strictEqual(new Set(markdown).size, 3); // a fresh file name each time
  for (const md of markdown) assert.match(md, /^!\[image\]\(https:\/\/github\.com\/o\/parallel\/blob\/null-issue-assets\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png\?raw=true\)$/);
});

test('an assets branch that already exists is not created again', async () => {
  const net = fakeApi({ getRefSha: async () => 'sha' });
  await uploadImage({ owner: 'o', repo: 'existing' }, 't', file(), net.api);
  assert.deepStrictEqual(net.log.map(l => l.split(' ')[0]), ['put']);
});

test('a failed upload does not block the next one, and the branch is looked up again', async () => {
  let failOnce = true;
  const net = fakeApi({
    putFile: async () => {
      if (failOnce) { failOnce = false; throw new Error('GitHub API 403: Resource not accessible'); }
    },
  });
  await assert.rejects(uploadImage({ owner: 'o', repo: 'flaky' }, 't', file(), net.api), /403/);
  await uploadImage({ owner: 'o', repo: 'flaky' }, 't', file(), net.api);
  assert.strictEqual(net.log.filter(l => l === 'get').length, 2);
});

test('a refused file never reaches GitHub', async () => {
  const net = fakeApi();
  await assert.rejects(uploadImage({ owner: 'o', repo: 'refused' }, 't', { name: 'a.txt', mime: 'text/plain', bytes: PNG }, net.api), UploadRejected);
  assert.deepStrictEqual(net.log, []);
});
