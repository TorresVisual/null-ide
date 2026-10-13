'use strict';

import { Category } from './types';

/**
 * A synced local file is named relative to the user-data folder with `/` separators:
 * `settings.json`, `keybindings.json` or `snippets/<name>`.
 */
export const SETTINGS = 'settings.json';
export const KEYBINDINGS = 'keybindings.json';
export const CORE_FILES = [SETTINGS, KEYBINDINGS];
/** The plaintext file in the Gist that holds the KDF parameters and the passphrase check. */
export const MANIFEST = 'manifest.json';

const SNIPPET_NAME = /^[^\\/:*?"<>|]+\.(json|code-snippets)$/i;

/** The only names this extension reads or writes. Remote names are untrusted, so every local path goes through here. */
export function isSyncableFile(file: string): boolean {
  if (file === SETTINGS || file === KEYBINDINGS) return true;
  return file.startsWith('snippets/') && SNIPPET_NAME.test(file.slice('snippets/'.length));
}

export function categoryOf(file: string): Category {
  return file === SETTINGS ? 'settings' : file === KEYBINDINGS ? 'keybindings' : 'snippets';
}

/** A deleted snippet file is a change to sync; a missing settings/keybindings file is "no local data". */
export const isDeletable = (file: string): boolean => file.startsWith('snippets/');

/** Gist file names cannot contain `/`. */
export const remoteNameOf = (file: string): string => `${file.replace('/', '__')}.enc`;

/** The local file a remote name stands for, or `undefined` if it is not exactly the name we would have written. */
export function fileOfRemoteName(name: string): string | undefined {
  if (!name.endsWith('.enc')) return undefined;
  const stem = name.slice(0, -'.enc'.length);
  const file = stem.startsWith('snippets__') ? `snippets/${stem.slice('snippets__'.length)}` : stem;
  return isSyncableFile(file) && remoteNameOf(file) === name ? file : undefined;
}
