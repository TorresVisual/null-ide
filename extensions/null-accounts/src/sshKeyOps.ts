'use strict';

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import {
  firstLine, isManagedKey, keygenArgs, keyFileName, managedKeyDir, parseFingerprint, parsePublicKey, PublicKey,
  publicKeyFile, signTestArgs, uniqueKeyPath,
} from './sshKey';
import { expandKeyPath } from './gitPlan';
import { RunTool, runTool, TOOL_UNAVAILABLE, ToolResult } from './tool';

const KEYGEN = 'ssh-keygen';
const NOT_FOUND = 'ssh-keygen was not found on your PATH. Install the OpenSSH client (Windows: Settings → Optional features → OpenSSH Client).';
// Never let ssh-keygen fall back to an askpass helper: nothing here can answer it.
const NO_ASKPASS = { SSH_ASKPASS_REQUIRE: 'never' };

const notFound = (r: ToolResult): boolean => r.code === TOOL_UNAVAILABLE && /ENOENT/.test(r.stderr);

/** Creates a passphrase-less ed25519 key in `~/.ssh/null-accounts/` and returns its path. Never overwrites a key. */
export async function generateKey(
  input: { home: string; host: string; username: string; email: string },
  run: RunTool = runTool,
  exists: (file: string) => boolean = fs.existsSync,
): Promise<string> {
  const dir = managedKeyDir(input.home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = uniqueKeyPath(dir, keyFileName(input.host, input.username), exists);
  const result = await run(KEYGEN, keygenArgs(file, input.email));
  if (notFound(result)) { throw new Error(NOT_FOUND); }
  if (result.code !== 0) { throw new Error(`ssh-keygen could not create the key: ${firstLine(result.stderr) || 'unknown error'}`); }
  return file;
}

/** The parsed `<keyFile>.pub`. `keyFile` is already expanded. */
export function readPublicKey(keyFile: string): PublicKey {
  const pub = publicKeyFile(keyFile);
  if (!fs.existsSync(pub)) {
    throw new Error(`There is no public key next to ${keyFile} (expected ${pub}).`);
  }
  return parsePublicKey(fs.readFileSync(pub, 'utf8'));
}

/** "SHA256:…" for the key, or `undefined` if it can't be read. Prefers the .pub so a passphrase never matters. */
export async function fingerprintOf(keyFile: string, run: RunTool = runTool): Promise<string | undefined> {
  const pub = publicKeyFile(keyFile);
  const result = await run(KEYGEN, ['-l', '-f', fs.existsSync(pub) ? pub : keyFile], { env: NO_ASKPASS });
  return result.code === 0 ? parseFingerprint(result.stdout) : undefined;
}

export interface SignCheck { ok: boolean; message: string }

/**
 * Whether git can sign with this key from inside the editor, without any prompt. A failed signature blocks the
 * commit, so signing is only ever switched on after this passes.
 */
export async function canSign(keyFile: string, run: RunTool = runTool): Promise<SignCheck> {
  // `-P ""` supplies an empty passphrase: a protected key fails here instead of waiting for a prompt nobody can answer.
  const unlocked = await run(KEYGEN, ['-y', '-P', '', '-f', keyFile], { env: NO_ASKPASS });
  if (notFound(unlocked)) { return { ok: false, message: NOT_FOUND }; }
  if (unlocked.code !== 0) {
    return {
      ok: false,
      message: `Git cannot sign with ${keyFile}: the key has a passphrase or cannot be read (${firstLine(unlocked.stderr) || 'no details'}). `
        + `Git cannot ask for a passphrase from inside the editor. Use a key Null IDE generated, or remove the passphrase with: ssh-keygen -p -f "${keyFile}"`,
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-accounts-sign-'));
  try {
    const message = path.join(dir, 'message');
    fs.writeFileSync(message, 'null-accounts signing test\n');
    const signed = await run(KEYGEN, signTestArgs(keyFile, message), { env: NO_ASKPASS });
    if (signed.code === 0 && fs.existsSync(`${message}.sig`)) { return { ok: true, message: 'ok' }; }
    return {
      ok: false,
      message: `ssh-keygen could not sign with this key (${firstLine(signed.stderr) || 'no details'}). Signing needs OpenSSH 8.0 or newer.`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Deletes a key pair Null IDE created. Anything outside `~/.ssh/null-accounts/` is refused, so a user's own key can never go. */
export function deleteManagedKey(keyFile: string, home: string): void {
  if (!isManagedKey(keyFile, home)) {
    throw new Error(`${keyFile} is not a key Null IDE created, so it will not be deleted.`);
  }
  const file = expandKeyPath(keyFile, home);
  fs.rmSync(file, { force: true });
  fs.rmSync(publicKeyFile(file), { force: true });
}
