'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesKey = matchesKey;
exports.stripExcluded = stripExcluded;
exports.reapplyExcluded = reapplyExcluded;
const jsonc_parser_1 = require("jsonc-parser");
/** The top-level object of a settings file; `{}` for an empty file (valid in VS Code); `undefined` if it is not a JSONC object. */
function parsed(text) {
    if (text.trim() === '')
        return {};
    const errors = [];
    const value = (0, jsonc_parser_1.parse)(text, errors, { allowTrailingComma: true });
    return errors.length === 0 && value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
/** Edits must reuse the file's own indentation and line endings, or they reformat the whole file. */
function formatting(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = /^([ \t]+)"/m.exec(text)?.[1];
    if (indent?.startsWith('\t'))
        return { insertSpaces: false, tabSize: 4, eol };
    return { insertSpaces: true, tabSize: indent?.length ?? 4, eol };
}
const edit = (text, key, value) => (0, jsonc_parser_1.applyEdits)(text, (0, jsonc_parser_1.modify)(text, [key], value, { formattingOptions: formatting(text) }));
/** `*` matches any run of characters; matching is case-insensitive and anchored to the whole key. */
function matchesKey(key, patterns) {
    return patterns.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(key));
}
/**
 * The text that is hashed and uploaded: `text` without its top-level keys that match `patterns`.
 * `undefined` if `text` is not a valid settings object. Comments and formatting of the other keys are preserved
 * (a trailing comment on a removed key may end up on the line above).
 */
function stripExcluded(text, patterns) {
    const settings = parsed(text);
    if (!settings)
        return undefined;
    return Object.keys(settings)
        .filter((key) => matchesKey(key, patterns))
        .reduce((acc, key) => edit(acc, key, undefined), text);
}
/**
 * Turns an uploaded (stripped) settings text into what to write locally: the incoming text plus this device's own values
 * for the excluded keys, taken from `current` (`null` = no local file). `undefined` if either side is not valid JSON.
 */
function reapplyExcluded(incoming, current, patterns) {
    const base = stripExcluded(incoming, patterns);
    if (base === undefined)
        return undefined;
    const mine = current === null ? {} : parsed(current);
    if (!mine)
        return undefined;
    const entries = Object.entries(mine).filter(([key]) => matchesKey(key, patterns));
    if (entries.length === 0)
        return base;
    return entries.reduce((acc, [key, value]) => edit(acc, key, value), base.trim() === '' ? '{}' : base);
}
//# sourceMappingURL=settingsFilter.js.map