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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKey = generateKey;
exports.readPublicKey = readPublicKey;
exports.fingerprintOf = fingerprintOf;
exports.canSign = canSign;
exports.deleteManagedKey = deleteManagedKey;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const sshKey_1 = require("./sshKey");
const gitPlan_1 = require("./gitPlan");
const tool_1 = require("./tool");
const KEYGEN = 'ssh-keygen';
const NOT_FOUND = 'ssh-keygen was not found on your PATH. Install the OpenSSH client (Windows: Settings → Optional features → OpenSSH Client).';
// Never let ssh-keygen fall back to an askpass helper: nothing here can answer it.
const NO_ASKPASS = { SSH_ASKPASS_REQUIRE: 'never' };
const notFound = (r) => r.code === tool_1.TOOL_UNAVAILABLE && /ENOENT/.test(r.stderr);
/** Creates a passphrase-less ed25519 key in `~/.ssh/null-accounts/` and returns its path. Never overwrites a key. */
async function generateKey(input, run = tool_1.runTool, exists = fs.existsSync) {
    const dir = (0, sshKey_1.managedKeyDir)(input.home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = (0, sshKey_1.uniqueKeyPath)(dir, (0, sshKey_1.keyFileName)(input.host, input.username), exists);
    const result = await run(KEYGEN, (0, sshKey_1.keygenArgs)(file, input.email));
    if (notFound(result)) {
        throw new Error(NOT_FOUND);
    }
    if (result.code !== 0) {
        throw new Error(`ssh-keygen could not create the key: ${(0, sshKey_1.firstLine)(result.stderr) || 'unknown error'}`);
    }
    return file;
}
/** The parsed `<keyFile>.pub`. `keyFile` is already expanded. */
function readPublicKey(keyFile) {
    const pub = (0, sshKey_1.publicKeyFile)(keyFile);
    if (!fs.existsSync(pub)) {
        throw new Error(`There is no public key next to ${keyFile} (expected ${pub}).`);
    }
    return (0, sshKey_1.parsePublicKey)(fs.readFileSync(pub, 'utf8'));
}
/** "SHA256:…" for the key, or `undefined` if it can't be read. Prefers the .pub so a passphrase never matters. */
async function fingerprintOf(keyFile, run = tool_1.runTool) {
    const pub = (0, sshKey_1.publicKeyFile)(keyFile);
    const result = await run(KEYGEN, ['-l', '-f', fs.existsSync(pub) ? pub : keyFile], { env: NO_ASKPASS });
    return result.code === 0 ? (0, sshKey_1.parseFingerprint)(result.stdout) : undefined;
}
/**
 * Whether git can sign with this key from inside the editor, without any prompt. A failed signature blocks the
 * commit, so signing is only ever switched on after this passes.
 */
async function canSign(keyFile, run = tool_1.runTool) {
    // `-P ""` supplies an empty passphrase: a protected key fails here instead of waiting for a prompt nobody can answer.
    const unlocked = await run(KEYGEN, ['-y', '-P', '', '-f', keyFile], { env: NO_ASKPASS });
    if (notFound(unlocked)) {
        return { ok: false, message: NOT_FOUND };
    }
    if (unlocked.code !== 0) {
        return {
            ok: false,
            message: `Git cannot sign with ${keyFile}: the key has a passphrase or cannot be read (${(0, sshKey_1.firstLine)(unlocked.stderr) || 'no details'}). `
                + `Git cannot ask for a passphrase from inside the editor. Use a key Null IDE generated, or remove the passphrase with: ssh-keygen -p -f "${keyFile}"`,
        };
    }
    const dir = fs.mkdtempSync(node_path_1.default.join(os.tmpdir(), 'null-accounts-sign-'));
    try {
        const message = node_path_1.default.join(dir, 'message');
        fs.writeFileSync(message, 'null-accounts signing test\n');
        const signed = await run(KEYGEN, (0, sshKey_1.signTestArgs)(keyFile, message), { env: NO_ASKPASS });
        if (signed.code === 0 && fs.existsSync(`${message}.sig`)) {
            return { ok: true, message: 'ok' };
        }
        return {
            ok: false,
            message: `ssh-keygen could not sign with this key (${(0, sshKey_1.firstLine)(signed.stderr) || 'no details'}). Signing needs OpenSSH 8.0 or newer.`,
        };
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
/** Deletes a key pair Null IDE created. Anything outside `~/.ssh/null-accounts/` is refused, so a user's own key can never go. */
function deleteManagedKey(keyFile, home) {
    if (!(0, sshKey_1.isManagedKey)(keyFile, home)) {
        throw new Error(`${keyFile} is not a key Null IDE created, so it will not be deleted.`);
    }
    const file = (0, gitPlan_1.expandKeyPath)(keyFile, home);
    fs.rmSync(file, { force: true });
    fs.rmSync((0, sshKey_1.publicKeyFile)(file), { force: true });
}
//# sourceMappingURL=sshKeyOps.js.map