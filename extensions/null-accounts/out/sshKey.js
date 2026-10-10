'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstLine = exports.signTestArgs = exports.keyTitle = exports.publicKeyFile = exports.keygenArgs = exports.managedKeyDir = void 0;
exports.keyFileName = keyFileName;
exports.uniqueKeyPath = uniqueKeyPath;
exports.parsePublicKey = parsePublicKey;
exports.parseFingerprint = parseFingerprint;
exports.isManagedKey = isManagedKey;
const node_path_1 = __importDefault(require("node:path"));
const gitPlan_1 = require("./gitPlan");
/** Where Null IDE puts the keys it creates. Only files in here are ever deleted. */
const managedKeyDir = (home) => node_path_1.default.join(home, '.ssh', 'null-accounts');
exports.managedKeyDir = managedKeyDir;
/** "git.example.org:8443" + "Ada Lovelace" -> "git.example.org_8443_ada_lovelace": one safe file name on every OS. */
function keyFileName(host, username) {
    return `${host}_${username}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^\.+/, '');
}
/** `<dir>/<base>_ed25519`, or `<base>_2_ed25519`, `_3_`… — never a name where a key or its .pub already is. */
function uniqueKeyPath(dir, baseName, exists) {
    for (let n = 1;; n++) {
        const file = node_path_1.default.join(dir, n === 1 ? `${baseName}_ed25519` : `${baseName}_${n}_ed25519`);
        if (!exists(file) && !exists(`${file}.pub`)) {
            return file;
        }
    }
}
/** `ssh-keygen` arguments for a passphrase-less ed25519 key. An argv: nothing here is parsed by a shell. */
const keygenArgs = (file, comment) => ['-t', 'ed25519', '-f', file, '-N', '', '-C', comment, '-q'];
exports.keygenArgs = keygenArgs;
const publicKeyFile = (keyFile) => `${keyFile}.pub`;
exports.publicKeyFile = publicKeyFile;
const PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,3})(?: (.*))?$/;
/** The first line of a `.pub` file. Refuses a private key outright, so a wrong file can never be uploaded or copied. */
function parsePublicKey(text) {
    if (/PRIVATE KEY/.test(text)) {
        throw new Error('That is a private key. Only the public key (.pub) is ever copied or uploaded.');
    }
    const line = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
    const match = PUBLIC_KEY.exec(line);
    if (!match) {
        throw new Error('That file is not a public key.');
    }
    return { type: match[1], blob: match[2], comment: match[3] ?? '', line };
}
/** "256 SHA256:abc… comment (ED25519)" -> "SHA256:abc…". */
function parseFingerprint(output) {
    return /\bSHA256:[A-Za-z0-9+/]+/.exec(output)?.[0];
}
/** The name the key gets on the server. */
const keyTitle = (hostname, date) => `Null IDE on ${hostname} (${date.toISOString().slice(0, 10)})`;
exports.keyTitle = keyTitle;
/** True only for a file strictly inside the managed folder. Resolves first, so `..` cannot climb out. */
function isManagedKey(keyFile, home) {
    const rel = node_path_1.default.relative((0, exports.managedKeyDir)(home), node_path_1.default.resolve((0, gitPlan_1.expandKeyPath)(keyFile, home)));
    return rel !== '' && !rel.startsWith('..') && !node_path_1.default.isAbsolute(rel);
}
/** `ssh-keygen -Y sign` on a message file; writes `<messageFile>.sig`. */
const signTestArgs = (keyFile, messageFile) => ['-Y', 'sign', '-f', keyFile, '-n', 'git', messageFile];
exports.signTestArgs = signTestArgs;
const firstLine = (text) => text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
exports.firstLine = firstLine;
//# sourceMappingURL=sshKey.js.map