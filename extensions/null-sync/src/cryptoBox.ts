'use strict';

import * as crypto from 'crypto';

const scrypt = (passphrase: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
/** N=32768, r=8 needs exactly 32 MB, which is over Node's default `maxmem`. */
const MAX_MEMORY = 64 * 1024 * 1024;
const CHECK_NAME = 'manifest.json';
const CHECK_TEXT = 'null-sync';

export const MIN_PASSPHRASE = 12;

export interface Manifest {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
  /** An envelope of a known string, to verify a passphrase without touching real data. */
  check: string;
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/** A message for the user, or `undefined` when the passphrase is acceptable. */
export function passphraseProblem(passphrase: string, confirmation: string): string | undefined {
  if ([...passphrase].length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (passphrase !== confirmation) return 'The two passphrases do not match.';
  return undefined;
}

const derive = (passphrase: string, salt: Buffer): Promise<Buffer> =>
  scrypt(passphrase.normalize('NFC'), salt, 32, { ...PARAMS, maxmem: MAX_MEMORY });

/** Encrypts `plaintext` for the Gist file `name`; the name is bound as additional authenticated data. */
export function seal(key: Buffer, name: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/** `undefined` for a wrong key, a tampered or renamed file, or anything that is not a v1 envelope. Never throws. */
export function open(key: Buffer, name: string, text: string): string | undefined {
  try {
    const envelope = JSON.parse(text) as Envelope;
    if (envelope.v !== 1) return undefined;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

export async function makeManifest(passphrase: string): Promise<{ manifest: Manifest; key: Buffer }> {
  const salt = crypto.randomBytes(16);
  const key = await derive(passphrase, salt);
  const manifest: Manifest = {
    v: 1,
    kdf: 'scrypt',
    ...PARAMS,
    salt: salt.toString('base64'),
    check: seal(key, CHECK_NAME, CHECK_TEXT),
  };
  return { manifest, key };
}

/** The key if `passphrase` matches this manifest; `undefined` for a wrong passphrase, an unknown format or parameters we did not write. */
export async function unlock(passphrase: string, manifestText: string | undefined): Promise<Buffer | undefined> {
  try {
    const m = JSON.parse(manifestText ?? '') as Manifest;
    if (m.v !== 1 || m.kdf !== 'scrypt' || m.N !== PARAMS.N || m.r !== PARAMS.r || m.p !== PARAMS.p) return undefined;
    const key = await derive(passphrase, Buffer.from(m.salt, 'base64'));
    return open(key, CHECK_NAME, m.check) === CHECK_TEXT ? key : undefined;
  } catch {
    return undefined;
  }
}
