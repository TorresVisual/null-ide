'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_SETTINGS = exports.FIRST_RUN_SCHEMA = void 0;
exports.parseFirstRun = parseFirstRun;
exports.installAll = installAll;
exports.runFirstRun = runFirstRun;
// Applies the choices null-setup left in %APPDATA%\Null\null-setup\first-run.json. No `vscode` import: the host does the I/O.
// The file sits in a user folder, so it is validated again here; the list below must equal setup/builtins.config.json's
// "settings" (a test pins them together).
exports.FIRST_RUN_SCHEMA = 1;
const oneOf = (...values) => v => typeof v === 'string' && values.includes(v);
const bool = v => typeof v === 'boolean';
const between = (min, max) => v => typeof v === 'number' && v >= min && v <= max;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
exports.ALLOWED_SETTINGS = {
    'workbench.colorTheme': oneOf('Null Dark', 'Null OLED', 'Null Light', 'Null Retro'),
    'editor.fontFamily': text,
    'editor.fontSize': between(8, 40),
    'files.autoSave': oneOf('off', 'afterDelay', 'onFocusChange', 'onWindowChange'),
    'editor.formatOnSave': bool,
    'window.menuBarVisibility': oneOf('classic', 'compact'),
    'null.updates.check': bool,
};
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const message = (e) => (e instanceof Error ? e.message : String(e));
function parseFirstRun(text) {
    let raw;
    try {
        raw = JSON.parse(text.replace(/^﻿/, ''));
    }
    catch {
        return undefined;
    }
    if (!raw || typeof raw !== 'object' || raw.schema !== exports.FIRST_RUN_SCHEMA) {
        return undefined;
    }
    const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {};
    const extensions = Array.isArray(raw.extensions)
        ? raw.extensions.filter((id) => typeof id === 'string' && EXTENSION_ID.test(id))
        : [];
    return { settings, extensions };
}
function withTimeout(p, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
/** One at a time, each with its own timeout. Returns the ids that did not install. */
async function installAll(host, ids, timeoutMs) {
    const failed = [];
    for (const id of ids) {
        try {
            await withTimeout(host.installExtension(id), timeoutMs);
            host.log(`installed ${id}`);
        }
        catch (err) {
            host.log(`could not install ${id}: ${message(err)}`);
            failed.push(id);
        }
    }
    return failed;
}
async function runFirstRun(host, timeoutMs) {
    const text = host.read();
    if (text === undefined) {
        return undefined;
    }
    const file = parseFirstRun(text);
    if (!file) {
        host.log('first-run.json is unusable; discarded');
        host.remove();
        return undefined;
    }
    const result = { applied: [], kept: [], failedSettings: [], failedExtensions: [] };
    for (const [key, value] of Object.entries(file.settings)) {
        // hasOwn: a plain lookup would find `constructor` and `toString` on the object.
        if (!Object.hasOwn(exports.ALLOWED_SETTINGS, key) || !exports.ALLOWED_SETTINGS[key](value)) {
            host.log(`ignored ${key}`);
            continue;
        }
        if (host.hasUserValue(key)) {
            result.kept.push(key);
            continue;
        }
        try {
            await host.setSetting(key, value);
            result.applied.push(key);
        }
        catch (err) {
            host.log(`could not set ${key}: ${message(err)}`);
            result.failedSettings.push(key);
        }
    }
    result.failedExtensions = await installAll(host, file.extensions, timeoutMs);
    // A failed settings write is worth another launch (setting is idempotent); a failed extension install is reported
    // once with Retry instead. ponytail: an extension the user ignores the notification for is not retried next launch.
    if (result.failedSettings.length === 0) {
        host.remove();
    }
    return result;
}
//# sourceMappingURL=firstRun.js.map