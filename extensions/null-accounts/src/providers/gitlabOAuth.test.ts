'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { fakeClock, fakePost } from '../testFakes';
import {
  DeviceCode, OAuthError, parseTokens, pollForToken, refreshTokens, serializeTokens, startDeviceFlow,
} from './gitlabOAuth';

const code: DeviceCode = {
  deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://gitlab.com/oauth/device', expiresIn: 300, interval: 5,
};
const pending = { status: 400, body: { error: 'authorization_pending' } };
const granted = { body: { access_token: 'at', refresh_token: 'rt', expires_in: 7200 } };

const failsWith = (reason: string) => (e: unknown): boolean => e instanceof OAuthError && e.reason === reason;

test('startDeviceFlow posts the client id and scopes and maps the response', async () => {
  const { post, calls } = fakePost({
    body: {
      device_code: 'dc', user_code: 'UC', verification_uri: 'https://git.example.org:8443/oauth/device',
      verification_uri_complete: 'https://git.example.org:8443/oauth/device?user_code=UC', expires_in: 300, interval: 5,
    },
  });
  const got = await startDeviceFlow(post, 'git.example.org:8443', 'cid');
  assert.strictEqual(calls[0].url, 'https://git.example.org:8443/oauth/authorize_device');
  assert.deepStrictEqual(calls[0].form, { client_id: 'cid', scope: 'read_user api write_repository' });
  assert.deepStrictEqual(got, {
    deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://git.example.org:8443/oauth/device',
    verificationUriComplete: 'https://git.example.org:8443/oauth/device?user_code=UC', expiresIn: 300, interval: 5,
  });
});

test('startDeviceFlow refuses an error reply, missing fields, and a non-https verification URL', async () => {
  const ok = { device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device' };
  for (const reply of [
    { status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } },
    { body: {} },
    { body: 'not json' },
    { body: { ...ok, verification_uri: 'http://gitlab.com/oauth/device' } },
    { body: { ...ok, verification_uri: 'javascript:alert(1)' } },
  ]) {
    await assert.rejects(startDeviceFlow(fakePost(reply).post, 'gitlab.com', 'cid'), failsWith('failed'), JSON.stringify(reply));
  }
});

test('startDeviceFlow drops a non-https verification_uri_complete but keeps the plain one', async () => {
  const { post } = fakePost({
    body: {
      device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device',
      verification_uri_complete: 'http://evil.example/x',
    },
  });
  const got = await startDeviceFlow(post, 'gitlab.com', 'cid');
  assert.strictEqual(got.verificationUriComplete, undefined);
  assert.strictEqual(got.expiresIn, 300); // defaults when the server omits them
  assert.strictEqual(got.interval, 5);
});

test('pollForToken waits one interval before each poll and returns the tokens when granted', async () => {
  const { post, calls } = fakePost(pending, pending, granted);
  const clock = fakeClock();
  const start = clock.now();
  const tokens = await pollForToken(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
  assert.deepStrictEqual(clock.slept, [5000, 5000, 5000]);
  assert.deepStrictEqual(tokens, { accessToken: 'at', refreshToken: 'rt', expiresAt: start + 15_000 + 7_200_000 });
  assert.strictEqual(calls[0].url, 'https://gitlab.com/oauth/token');
  assert.deepStrictEqual(calls[0].form, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'dc', client_id: 'cid',
  });
});

test('slow_down lengthens the polling interval by 5 seconds', async () => {
  const { post } = fakePost({ status: 400, body: { error: 'slow_down' } }, granted);
  const clock = fakeClock();
  await pollForToken(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
  assert.deepStrictEqual(clock.slept, [5000, 10_000]);
});

test('denied, server-expired and unknown errors end the flow with the right reason', async () => {
  const run = (body: unknown) =>
    pollForToken(fakePost({ status: 400, body }).post, 'gitlab.com', 'cid', code, { ...fakeClock(), cancelled: () => false });
  await assert.rejects(run({ error: 'access_denied' }), failsWith('denied'));
  await assert.rejects(run({ error: 'expired_token' }), failsWith('expired'));
  await assert.rejects(run({ error: 'server_error', error_description: 'boom' }), failsWith('failed'));
  await assert.rejects(run(undefined), failsWith('failed'));
});

test('the flow also gives up on its own once the code lifetime has passed', async () => {
  const { post, calls } = fakePost(pending, pending, pending);
  await assert.rejects(
    pollForToken(post, 'gitlab.com', 'cid', { ...code, expiresIn: 10, interval: 5 }, { ...fakeClock(), cancelled: () => false }),
    failsWith('expired'),
  );
  assert.strictEqual(calls.length, 1); // 5 s: poll; 10 s: out of time
});

test('a cancelled flow stops before asking the server again', async () => {
  const { post, calls } = fakePost();
  await assert.rejects(
    pollForToken(post, 'gitlab.com', 'cid', code, { ...fakeClock(), cancelled: () => true }),
    failsWith('cancelled'),
  );
  assert.strictEqual(calls.length, 0);
});

test('refreshTokens posts the refresh grant and maps the rotated pair', async () => {
  const { post, calls } = fakePost({ body: { access_token: 'new', refresh_token: 'rt2', expires_in: 7200 } });
  const clock = fakeClock();
  const got = await refreshTokens(post, 'gitlab.com', 'cid', 'rt1', clock.now);
  assert.deepStrictEqual(got, { accessToken: 'new', refreshToken: 'rt2', expiresAt: clock.now() + 7_200_000 });
  assert.deepStrictEqual(calls[0].form, { grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
});

test('refreshTokens: 400/401 means rejected; any other failure means transient', async () => {
  const run = (reply: { status: number; body: unknown }) =>
    refreshTokens(fakePost(reply).post, 'gitlab.com', 'cid', 'rt1', fakeClock().now);
  await assert.rejects(run({ status: 400, body: { error: 'invalid_grant' } }), failsWith('rejected'));
  await assert.rejects(run({ status: 401, body: {} }), failsWith('rejected'));
  await assert.rejects(run({ status: 500, body: 'oops' }), failsWith('failed'));
  await assert.rejects(run({ status: 200, body: {} }), failsWith('failed')); // 200 without a token is not a refresh
  // a network failure is not an OAuthError at all: the caller treats it as transient too
  await assert.rejects(
    refreshTokens(async () => { throw new Error('offline'); }, 'gitlab.com', 'cid', 'rt1', fakeClock().now),
    (e: unknown) => !(e instanceof OAuthError),
  );
});

test('tokens survive a serialise/parse round trip; junk parses to undefined', () => {
  const t = { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 };
  assert.deepStrictEqual(parseTokens(serializeTokens(t)), t);
  assert.deepStrictEqual(parseTokens(serializeTokens({ accessToken: 'at' })), { accessToken: 'at', refreshToken: undefined, expiresAt: undefined });
  for (const bad of [undefined, '', 'not json', '[]', '{}', '{"accessToken":""}', '{"accessToken":5}', 'null']) {
    assert.strictEqual(parseTokens(bad), undefined, String(bad));
  }
});
