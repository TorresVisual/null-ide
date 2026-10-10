'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GITHUB_KEY_SCOPES, HttpReply, keySettingsUrl, PostJson, uploadPublicKey } from './keyUpload';

const KEY = { type: 'ssh-ed25519', blob: 'AAAAC3', comment: 'ada@uni.example', line: 'ssh-ed25519 AAAAC3 ada@uni.example' };
const TOKEN = 'tok-secret-123';
const github = { provider: 'github' as const, host: 'github.com' };
const gitlab = { provider: 'gitlab' as const, host: 'git.uni.example' };

function fakePost(...replies: HttpReply[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const post: PostJson = async (url, headers, body) => {
    calls.push({ url, headers, body });
    const next = replies.shift();
    if (!next) { throw new Error('unexpected extra request'); }
    return next;
  };
  return { post, calls };
}
const GH_DUPLICATE = { status: 422, body: { message: 'Validation Failed', errors: [{ message: 'key is already in use' }] } };

test('GitHub: the key is added for authentication and again as a signing key, comment left off', async () => {
  const { post, calls } = fakePost({ status: 201, body: {} }, { status: 201, body: {} });
  assert.deepStrictEqual(await uploadPublicKey(github, TOKEN, KEY, 'Null IDE on PC', post), { ok: true, already: false });
  assert.deepStrictEqual(calls.map(c => c.url), ['https://api.github.com/user/keys', 'https://api.github.com/user/ssh_signing_keys']);
  assert.deepStrictEqual(calls[0].body, { title: 'Null IDE on PC', key: 'ssh-ed25519 AAAAC3' });
  assert.strictEqual(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
});

test('GitHub: a key the account already has is a success, not an error', async () => {
  const { post } = fakePost(GH_DUPLICATE, GH_DUPLICATE);
  assert.deepStrictEqual(await uploadPublicKey(github, TOKEN, KEY, 't', post), { ok: true, already: true });
});

test('GitHub: if only the signing-key step fails, the message says the key was added but not for signing', async () => {
  const { post } = fakePost({ status: 201, body: {} }, { status: 403, body: { message: 'Resource not accessible' } });
  const result = await uploadPublicKey(github, TOKEN, KEY, 't', post);
  assert.strictEqual(result.ok, false);
  assert.match((result as { message: string }).message, /added for pushing, but not as a signing key/);
});

test('GitHub: a refused sign-in says which permission to allow, stops after one request, and never repeats the token', async () => {
  const { post, calls } = fakePost({ status: 403, body: { message: 'Must have admin rights' } });
  const result = await uploadPublicKey(github, TOKEN, KEY, 't', post);
  assert.strictEqual(result.ok, false);
  const message = (result as { message: string }).message;
  assert.match(message, /write:public_key/);
  assert.ok(!message.includes(TOKEN));
  assert.strictEqual(calls.length, 1);
});

test('GitLab: one request adds the key for authentication and signing; duplicates and refusals are told apart', async () => {
  const ok = fakePost({ status: 201, body: {} });
  assert.deepStrictEqual(await uploadPublicKey(gitlab, TOKEN, KEY, 'Null IDE on PC', ok.post), { ok: true, already: false });
  assert.strictEqual(ok.calls[0].url, 'https://git.uni.example/api/v4/user/keys');
  assert.deepStrictEqual(ok.calls[0].body, { title: 'Null IDE on PC', key: 'ssh-ed25519 AAAAC3', usage_type: 'auth_and_signing' });
  assert.strictEqual(ok.calls[0].headers.Authorization, `Bearer ${TOKEN}`);

  const dup = fakePost({ status: 400, body: { message: { fingerprint: ['has already been taken'], key: ['has already been taken'] } } });
  assert.deepStrictEqual(await uploadPublicKey(gitlab, TOKEN, KEY, 't', dup.post), { ok: true, already: true });

  const denied = fakePost({ status: 403, body: { message: '403 Forbidden' } });
  const refusal = await uploadPublicKey(gitlab, TOKEN, KEY, 't', denied.post);
  assert.match((refusal as { message: string }).message, /"api" scope/);
});

test('a network failure is reported as unreachable, with the host', async () => {
  const post: PostJson = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const result = await uploadPublicKey(gitlab, TOKEN, KEY, 't', post);
  assert.deepStrictEqual(result, { ok: false, message: 'Could not reach git.uni.example.' });
});

test('the settings page to paste a key into, and the scopes GitHub needs', () => {
  assert.strictEqual(keySettingsUrl(github), 'https://github.com/settings/ssh/new');
  assert.strictEqual(keySettingsUrl(gitlab), 'https://git.uni.example/-/user_settings/ssh_keys');
  assert.deepStrictEqual(GITHUB_KEY_SCOPES, ['write:public_key', 'write:ssh_signing_key']);
});
