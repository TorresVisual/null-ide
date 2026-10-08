'use strict';

import path from 'node:path';
import { expandKeyPath } from './gitPlan';

/** Where Null IDE puts the keys it creates. Only files in here are ever deleted. */
export const managedKeyDir = (home: string): string => path.join(home, '.ssh', 'null-accounts');

/** "git.example.org:8443" + "Ada Lovelace" -> "git.example.org_8443_ada_lovelace": one safe file name on every OS. */
export function keyFileName(host: string, username: string): string {
  return `${host}_${username}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^\.+/, '');
}

/** `<dir>/<base>_ed25519`, or `<base>_2_ed25519`, `_3_`… — never a name where a key or its .pub already is. */
export function uniqueKeyPath(dir: string, baseName: string, exists: (file: string) => boolean): string {
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? `${baseName}_ed25519` : `${baseName}_${n}_ed25519`);
    if (!exists(file) && !exists(`${file}.pub`)) { return file; }
  }
}

/** `ssh-keygen` arguments for a passphrase-less ed25519 key. An argv: nothing here is parsed by a shell. */
export const keygenArgs = (file: string, comment: string): string[] =>
  ['-t', 'ed25519', '-f', file, '-N', '', '-C', comment, '-q'];

export const publicKeyFile = (keyFile: string): string => `${keyFile}.pub`;

export interface PublicKey { type: string; blob: string; comment: string; line: string }

const PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,3})(?: (.*))?$/;

/** The first line of a `.pub` file. Refuses a private key outright, so a wrong file can never be uploaded or copied. */
export function parsePublicKey(text: string): PublicKey {
  if (/PRIVATE KEY/.test(text)) {
    throw new Error('That is a private key. Only the public key (.pub) is ever copied or uploaded.');
  }
  const line = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
  const match = PUBLIC_KEY.exec(line);
  if (!match) { throw new Error('That file is not a public key.'); }
  return { type: match[1], blob: match[2], comment: match[3] ?? '', line };
}

/** "256 SHA256:abc… comment (ED25519)" -> "SHA256:abc…". */
export function parseFingerprint(output: string): string | undefined {
  return /\bSHA256:[A-Za-z0-9+/]+/.exec(output)?.[0];
}

/** The name the key gets on the server. */
export const keyTitle = (hostname: string, date: Date): string =>
  `Null IDE on ${hostname} (${date.toISOString().slice(0, 10)})`;

/** True only for a file strictly inside the managed folder. Resolves first, so `..` cannot climb out. */
export function isManagedKey(keyFile: string, home: string): boolean {
  const rel = path.relative(managedKeyDir(home), path.resolve(expandKeyPath(keyFile, home)));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** `ssh-keygen -Y sign` on a message file; writes `<messageFile>.sig`. */
export const signTestArgs = (keyFile: string, messageFile: string): string[] =>
  ['-Y', 'sign', '-f', keyFile, '-n', 'git', messageFile];

export const firstLine = (text: string): string => text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
