'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  base64UrlEncode,
  generateCodeChallenge,
  generateCodeVerifier,
  generatePkcePair,
  generateRandomString,
} from '../auth/pkce';

test('base64UrlEncode correctly removes padding and replaces URL-unsafe chars', () => {
  const buf = Buffer.from('test string with + / and = padding');
  const encoded = base64UrlEncode(buf);
  assert.ok(!encoded.includes('+'), 'should not contain +');
  assert.ok(!encoded.includes('/'), 'should not contain /');
  assert.ok(!encoded.includes('='), 'should not contain =');
});

test('generateRandomString produces string of expected length', () => {
  const str32 = generateRandomString(32);
  assert.strictEqual(str32.length, 32);

  const str64 = generateRandomString(64);
  assert.strictEqual(str64.length, 64);
});

test('generatePkcePair creates matching verifier and challenge', () => {
  const pair = generatePkcePair();
  assert.ok(pair.verifier.length >= 43 && pair.verifier.length <= 128);
  assert.ok(pair.challenge.length > 0);

  const expectedChallenge = generateCodeChallenge(pair.verifier);
  assert.strictEqual(pair.challenge, expectedChallenge);
});
