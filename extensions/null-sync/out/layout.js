'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.remoteNameOf = exports.isDeletable = exports.EXTENSIONS_REMOTE = exports.MANIFEST = exports.CORE_FILES = exports.KEYBINDINGS = exports.SETTINGS = void 0;
exports.isSyncableFile = isSyncableFile;
exports.categoryOf = categoryOf;
exports.fileOfRemoteName = fileOfRemoteName;
/**
 * A synced local file is named relative to the user-data folder with `/` separators:
 * `settings.json`, `keybindings.json` or `snippets/<name>`.
 */
exports.SETTINGS = 'settings.json';
exports.KEYBINDINGS = 'keybindings.json';
exports.CORE_FILES = [exports.SETTINGS, exports.KEYBINDINGS];
/** The plaintext file in the Gist that holds the KDF parameters and the passphrase check. */
exports.MANIFEST = 'manifest.json';
/** The remote file that holds the encrypted list of installed extension IDs (not a local file). */
exports.EXTENSIONS_REMOTE = 'extensions.json.enc';
const SNIPPET_NAME = /^[^\\/:*?"<>|]+\.(json|code-snippets)$/i;
/** The only names this extension reads or writes. Remote names are untrusted, so every local path goes through here. */
function isSyncableFile(file) {
    if (file === exports.SETTINGS || file === exports.KEYBINDINGS)
        return true;
    return file.startsWith('snippets/') && SNIPPET_NAME.test(file.slice('snippets/'.length));
}
function categoryOf(file) {
    return file === exports.SETTINGS ? 'settings' : file === exports.KEYBINDINGS ? 'keybindings' : 'snippets';
}
/** A deleted snippet file is a change to sync; a missing settings/keybindings file is "no local data". */
const isDeletable = (file) => file.startsWith('snippets/');
exports.isDeletable = isDeletable;
/** Gist file names cannot contain `/`. */
const remoteNameOf = (file) => `${file.replace('/', '__')}.enc`;
exports.remoteNameOf = remoteNameOf;
/** The local file a remote name stands for, or `undefined` if it is not exactly the name we would have written. */
function fileOfRemoteName(name) {
    if (!name.endsWith('.enc'))
        return undefined;
    const stem = name.slice(0, -'.enc'.length);
    const file = stem.startsWith('snippets__') ? `snippets/${stem.slice('snippets__'.length)}` : stem;
    return isSyncableFile(file) && (0, exports.remoteNameOf)(file) === name ? file : undefined;
}
//# sourceMappingURL=layout.js.map