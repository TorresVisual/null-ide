'use strict';

// Applies the choices null-setup left in %APPDATA%\Null\null-setup\first-run.json. No `vscode` import: the host does the I/O.
// The file sits in a user folder, so it is validated again here; the list below must equal setup/builtins.config.json's
// "settings" (a test pins them together).

export const FIRST_RUN_SCHEMA = 1;

type Rule = (v: unknown) => boolean;

const oneOf = (...values: string[]): Rule => v => typeof v === 'string' && values.includes(v);
const bool: Rule = v => typeof v === 'boolean';
const between = (min: number, max: number): Rule => v => typeof v === 'number' && v >= min && v <= max;
const text: Rule = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);

export const ALLOWED_SETTINGS: Record<string, Rule> = {
  'workbench.colorTheme': oneOf('Null Dark', 'Null OLED', 'Null Light', 'Null Retro'),
  'editor.fontFamily': text,
  'editor.fontSize': between(8, 40),
  'files.autoSave': oneOf('off', 'afterDelay', 'onFocusChange', 'onWindowChange'),
  'editor.formatOnSave': bool,
  'window.menuBarVisibility': oneOf('classic', 'compact'),
  'null.updates.check': bool,
};

export interface FirstRunHost {
  /** The file's text, or undefined when there is none. */
  read(): string | undefined;
  /** Must not throw when the file is already gone (a second window may have taken it). */
  remove(): void;
  /** True when the user has a global value for the key, whatever it is. */
  hasUserValue(key: string): boolean;
  setSetting(key: string, value: unknown): Promise<void>;
  installExtension(id: string): Promise<void>;
  log(message: string): void;
}

export interface FirstRunResult {
  applied: string[];
  kept: string[];
  failedSettings: string[];
  failedExtensions: string[];
}

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseFirstRun(text: string): { settings: Record<string, unknown>; extensions: string[] } | undefined {
  let raw: any;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch { return undefined; }
  if (!raw || typeof raw !== 'object' || raw.schema !== FIRST_RUN_SCHEMA) { return undefined; }
  const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {};
  const extensions = Array.isArray(raw.extensions)
    ? raw.extensions.filter((id: unknown): id is string => typeof id === 'string' && EXTENSION_ID.test(id))
    : [];
  return { settings, extensions };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** One at a time, each with its own timeout. Returns the ids that did not install. */
export async function installAll(host: FirstRunHost, ids: string[], timeoutMs: number): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await withTimeout(host.installExtension(id), timeoutMs);
      host.log(`installed ${id}`);
    } catch (err) {
      host.log(`could not install ${id}: ${message(err)}`);
      failed.push(id);
    }
  }
  return failed;
}

export async function runFirstRun(host: FirstRunHost, timeoutMs: number): Promise<FirstRunResult | undefined> {
  const text = host.read();
  if (text === undefined) { return undefined; }
  const file = parseFirstRun(text);
  if (!file) {
    host.log('first-run.json is unusable; discarded');
    host.remove();
    return undefined;
  }

  const result: FirstRunResult = { applied: [], kept: [], failedSettings: [], failedExtensions: [] };
  for (const [key, value] of Object.entries(file.settings)) {
    // hasOwn: a plain lookup would find `constructor` and `toString` on the object.
    if (!Object.hasOwn(ALLOWED_SETTINGS, key) || !ALLOWED_SETTINGS[key](value)) {
      host.log(`ignored ${key}`);
      continue;
    }
    if (host.hasUserValue(key)) { result.kept.push(key); continue; }
    try {
      await host.setSetting(key, value);
      result.applied.push(key);
    } catch (err) {
      host.log(`could not set ${key}: ${message(err)}`);
      result.failedSettings.push(key);
    }
  }
  result.failedExtensions = await installAll(host, file.extensions, timeoutMs);

  // A failed settings write is worth another launch (setting is idempotent); a failed extension install is reported
  // once with Retry instead. ponytail: an extension the user ignores the notification for is not retried next launch.
  if (result.failedSettings.length === 0) { host.remove(); }
  return result;
}
