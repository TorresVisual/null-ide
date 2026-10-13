'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_PASSPHRASE = void 0;
exports.passphraseProblem = passphraseProblem;
exports.seal = seal;
exports.open = open;
exports.makeManifest = makeManifest;
exports.unlock = unlock;
const crypto = __importStar(require("crypto"));
const scrypt = (passphrase, salt, keylen, options) => new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
});
const PARAMS = { N: 32768, r: 8, p: 1 };
/** N=32768, r=8 needs exactly 32 MB, which is over Node's default `maxmem`. */
const MAX_MEMORY = 64 * 1024 * 1024;
const CHECK_NAME = 'manifest.json';
const CHECK_TEXT = 'null-sync';
exports.MIN_PASSPHRASE = 12;
/** A message for the user, or `undefined` when the passphrase is acceptable. */
function passphraseProblem(passphrase, confirmation) {
    if ([...passphrase].length < exports.MIN_PASSPHRASE)
        return `Use at least ${exports.MIN_PASSPHRASE} characters.`;
    if (passphrase !== confirmation)
        return 'The two passphrases do not match.';
    return undefined;
}
const derive = (passphrase, salt) => scrypt(passphrase.normalize('NFC'), salt, 32, { ...PARAMS, maxmem: MAX_MEMORY });
/** Encrypts `plaintext` for the Gist file `name`; the name is bound as additional authenticated data. */
function seal(key, name, plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(name));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelope = {
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    };
    return JSON.stringify(envelope);
}
/** `undefined` for a wrong key, a tampered or renamed file, or anything that is not a v1 envelope. Never throws. */
function open(key, name, text) {
    try {
        const envelope = JSON.parse(text);
        if (envelope.v !== 1)
            return undefined;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'), { authTagLength: 16 });
        decipher.setAAD(Buffer.from(name));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
    }
    catch {
        return undefined;
    }
}
async function makeManifest(passphrase) {
    const salt = crypto.randomBytes(16);
    const key = await derive(passphrase, salt);
    const manifest = {
        v: 1,
        kdf: 'scrypt',
        ...PARAMS,
        salt: salt.toString('base64'),
        check: seal(key, CHECK_NAME, CHECK_TEXT),
    };
    return { manifest, key };
}
/** The key if `passphrase` matches this manifest; `undefined` for a wrong passphrase, an unknown format or parameters we did not write. */
async function unlock(passphrase, manifestText) {
    try {
        const m = JSON.parse(manifestText ?? '');
        if (m.v !== 1 || m.kdf !== 'scrypt' || m.N !== PARAMS.N || m.r !== PARAMS.r || m.p !== PARAMS.p)
            return undefined;
        const key = await derive(passphrase, Buffer.from(m.salt, 'base64'));
        return open(key, CHECK_NAME, m.check) === CHECK_TEXT ? key : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=cryptoBox.js.map