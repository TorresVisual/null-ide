'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AvatarCache } from './avatars';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const gh = (id: string, username = id): Account => ({ id, provider: 'github', host: 'github.com', username, email: 'e@e.com', authMethod: 'oauth' });
const gl = (id: string, host = 'git.example.org'): Account => ({ id, provider: 'gitlab', host, username: id, email: 'e@e.com', authMethod: 'oauth' });
const PNG = { type: 'image/png', bytes: new Uint8Array([1, 2, 3]) };

function setup(accounts: Account[], image: { type: string; bytes: Uint8Array } | null = PNG, json: unknown = undefined) {
  const list = { current: accounts };
  const urls: string[] = [];
  const cache = new AvatarCache({
    meta: new FakeMeta(),
    accounts: () => list.current,
    getJson: async url => { urls.push(url); return json; },
    getImage: async url => { urls.push(url); return image ?? undefined; },
  });
  return { cache, list, urls };
}

test('a GitHub account gets its github.com picture as a data URI, fetched once', async () => {
  const { cache, urls } = setup([gh('a1', 'octo')]);
  await cache.refresh();
  assert.strictEqual(cache.get('a1'), 'data:image/png;base64,AQID');
  assert.deepStrictEqual(urls, ['https://github.com/octo.png?size=64']);
  await cache.refresh();
  assert.strictEqual(urls.length, 1);
});

test('a GitLab account looks its avatar up on its own host, https only', async () => {
  const { cache, urls } = setup([gl('u')], PNG, [{ avatar_url: 'https://git.example.org/uploads/u.png' }]);
  await cache.refresh();
  assert.ok(cache.get('u'));
  assert.strictEqual(urls[0], 'https://git.example.org/api/v4/users?username=u');
  assert.match(urls[1], /^https:\/\/git\.example\.org\/uploads\/u\.png\?width=64&s=64$/);
  const plain = setup([gl('u')], PNG, [{ avatar_url: 'http://git.example.org/u.png' }]);
  await plain.cache.refresh();
  assert.strictEqual(plain.cache.get('u'), undefined);
});

test('non-images, oversized or empty replies and failures leave no avatar and are not retried this session', async () => {
  for (const image of [null, { type: 'image/svg+xml', bytes: PNG.bytes }, { type: 'image/png', bytes: new Uint8Array(0) }, { type: 'image/png', bytes: new Uint8Array(200_000) }]) {
    const { cache, urls } = setup([gh('a1')], image);
    await cache.refresh();
    await cache.refresh();
    assert.strictEqual(cache.get('a1'), undefined);
    assert.strictEqual(urls.length, 1);
  }
});

test('avatars of removed or renamed accounts are dropped, and a change is announced only when something changed', async () => {
  const { cache, list } = setup([gh('a1'), gh('a2')]);
  let fired = 0;
  cache.onDidChange(() => { fired++; });
  await cache.refresh();
  assert.strictEqual(fired, 1);
  await cache.refresh();
  assert.strictEqual(fired, 1);
  list.current = [gh('a1', 'renamed')];
  await cache.refresh();
  assert.strictEqual(cache.get('a2'), undefined);
  assert.ok(cache.get('a1'));
  assert.strictEqual(fired, 2);
});
