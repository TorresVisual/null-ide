'use strict';

import * as crypto from 'crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateRandomString(length: number = 64): string {
  const bytes = crypto.randomBytes(length);
  return base64UrlEncode(bytes).slice(0, length);
}

export function generateCodeVerifier(): string {
  return generateRandomString(64);
}

export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

export function generatePkcePair(): PkcePair {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  return { verifier, challenge };
}
