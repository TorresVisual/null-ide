import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { makeManifest, open, passphraseProblem, seal, unlock } from './cryptoBox';

const PASS = 'correct horse battery staple';

describe('seal / open', () => {
  const key = Buffer.alloc(32, 7);

  it('round-trips text, including unicode, CRLF and empty', () => {
    for (const text of ['', 'hello', '{"a": "päss 日本語 🚀"}\r\n']) {
      assert.equal(open(key, 'x.enc', seal(key, 'x.enc', text)), text);
    }
  });

  it('uses a fresh IV every time', () => {
    assert.notEqual(seal(key, 'x', 'a'), seal(key, 'x', 'a'));
  });

  it('fails for the wrong key', () => {
    assert.equal(open(Buffer.alloc(32, 8), 'x', seal(key, 'x', 'secret')), undefined);
  });

  it('fails when the file name differs (a ciphertext moved to another name)', () => {
    assert.equal(open(key, 'y', seal(key, 'x', 'secret')), undefined);
  });

  it('fails when a ciphertext bit is flipped', () => {
    const e = JSON.parse(seal(key, 'x', 'secret'));
    const data = Buffer.from(e.data, 'base64');
    data[0] ^= 1;
    e.data = data.toString('base64');
    assert.equal(open(key, 'x', JSON.stringify(e)), undefined);
  });

  it('fails for a truncated auth tag', () => {
    const e = JSON.parse(seal(key, 'x', 'secret'));
    e.tag = Buffer.from(e.tag, 'base64').subarray(0, 4).toString('base64');
    assert.equal(open(key, 'x', JSON.stringify(e)), undefined);
  });

  it('rejects garbage and unknown versions without throwing', () => {
    for (const t of ['', 'not json', '{}', 'null', '{"v":2,"iv":"","tag":"","data":""}']) {
      assert.equal(open(key, 'x', t), undefined, t);
    }
  });
});

describe('manifest', () => {
  it('unlocks with the right passphrase and not with a wrong one', async () => {
    const { manifest, key } = await makeManifest(PASS);
    const text = JSON.stringify(manifest);
    assert.deepEqual(await unlock(PASS, text), key);
    assert.equal(await unlock(`${PASS}!`, text), undefined);
  });

  it('treats a unicode passphrase the same however it is composed', async () => {
    const composed = 'paßwörd 日本語 123';
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed);
    const { manifest } = await makeManifest(composed);
    assert.ok(await unlock(decomposed, JSON.stringify(manifest)));
  });

  it('refuses a missing manifest, garbage, or other KDF parameters', async () => {
    const { manifest } = await makeManifest(PASS);
    assert.equal(await unlock(PASS, undefined), undefined);
    assert.equal(await unlock(PASS, 'nope'), undefined);
    assert.equal(await unlock(PASS, JSON.stringify({ ...manifest, N: 2 ** 20 })), undefined);
    assert.equal(await unlock(PASS, JSON.stringify({ ...manifest, v: 2 })), undefined);
  });
});

describe('passphraseProblem', () => {
  it('requires 12 characters and a matching confirmation', () => {
    assert.match(passphraseProblem('short', 'short')!, /12/);
    assert.match(passphraseProblem('long enough passphrase', 'different one here')!, /match/);
    assert.equal(passphraseProblem('long enough passphrase', 'long enough passphrase'), undefined);
  });

  it('counts characters', () => {
    assert.equal(passphraseProblem('123456789012', '123456789012'), undefined);
    assert.match(passphraseProblem('12345678901', '12345678901')!, /12/);
  });
});
