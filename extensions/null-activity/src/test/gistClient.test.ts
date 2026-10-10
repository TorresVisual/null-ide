'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GistFile, HttpJson, HttpReply, gistRawUrl, publishGist } from '../gistClient';

const files: GistFile[] = [{ name: 'a.svg', content: '<svg/>' }, { name: 'b.svg', content: '<svg b/>' }];
const OK = { id: 'g1', owner: { login: 'alice' } };

function fake(replies: Array<HttpReply | Error>) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: Record<string, any> }> = [];
  const http: HttpJson = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next!;
  };
  return { http, calls };
}

test('creates a secret gist and reports its id and owner', async () => {
  const { http, calls } = fake([{ status: 201, body: OK }]);
  const result = await publishGist(http, 'tok', undefined, files);
  assert.deepStrictEqual(result, { ok: true, id: 'g1', owner: 'alice' });
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://api.github.com/gists');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
  assert.strictEqual(calls[0].body.public, false);
  assert.deepStrictEqual(calls[0].body.files, { 'a.svg': { content: '<svg/>' }, 'b.svg': { content: '<svg b/>' } });
});

test('updates an existing gist in place', async () => {
  const { http, calls } = fake([{ status: 200, body: OK }]);
  assert.deepStrictEqual(await publishGist(http, 'tok', 'g1', files), { ok: true, id: 'g1', owner: 'alice' });
  assert.strictEqual(calls[0].method, 'PATCH');
  assert.strictEqual(calls[0].url, 'https://api.github.com/gists/g1');
  assert.ok(!('public' in calls[0].body));
});

test('404 on update means the gist was deleted: create a new one', async () => {
  const { http, calls } = fake([{ status: 404, body: { message: 'Not Found' } }, { status: 201, body: { id: 'g2', owner: { login: 'alice' } } }]);
  assert.deepStrictEqual(await publishGist(http, 'tok', 'g1', files), { ok: true, id: 'g2', owner: 'alice' });
  assert.deepStrictEqual(calls.map((c) => c.method), ['PATCH', 'POST']);
});

test('401/403 explain the missing scope and never echo the token', async () => {
  for (const status of [401, 403]) {
    const result = await publishGist(fake([{ status, body: { message: 'Bad credentials' } }]).http, 'secret-token', undefined, files);
    assert.strictEqual(result.ok, false);
    const message = (result as { message: string }).message;
    assert.ok(message.includes(`HTTP ${status}`));
    assert.ok(message.includes('gist'));
    assert.ok(!message.includes('secret-token'));
  }
});

test('other statuses and malformed success bodies become a message', async () => {
  const server = await publishGist(fake([{ status: 500, body: { message: 'boom' } }]).http, 't', undefined, files);
  assert.deepStrictEqual(server, { ok: false, message: 'GitHub answered HTTP 500: boom' });
  const malformed = await publishGist(fake([{ status: 201, body: { nope: true } }]).http, 't', undefined, files);
  assert.deepStrictEqual(malformed, { ok: false, message: 'GitHub answered HTTP 201.' });
});

test('a network failure is a result, not a throw', async () => {
  const result = await publishGist(fake([new Error('ETIMEDOUT')]).http, 't', undefined, files);
  assert.deepStrictEqual(result, { ok: false, message: 'Could not reach GitHub (ETIMEDOUT).' });
});

test('raw URL has no revision so it always serves the latest file', () => {
  assert.strictEqual(gistRawUrl('alice', 'g1', 'a.svg'), 'https://gist.githubusercontent.com/alice/g1/raw/a.svg');
});
