'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const sshKeyOps_1 = require("./sshKeyOps");
const sshKey_1 = require("./sshKey");
const tool_1 = require("./tool");
const real = { skip: (0, node_child_process_1.spawnSync)('ssh-keygen', ['-?']).error ? 'ssh-keygen is not installed' : false };
const home = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'null-accounts-keys-'));
(0, node_test_1.after)(() => (0, node_fs_1.rmSync)(home, { recursive: true, force: true }));
const input = { home, host: 'git.uni.example', username: 'Ada', email: 'ada@uni.example' };
(0, node_test_1.test)('generateKey makes a passphrase-less ed25519 pair in the managed folder, and never reuses a name', real, async () => {
    const first = await (0, sshKeyOps_1.generateKey)(input);
    node_assert_1.default.strictEqual(first, node_path_1.default.join((0, sshKey_1.managedKeyDir)(home), 'git.uni.example_ada_ed25519'));
    node_assert_1.default.ok((0, node_fs_1.existsSync)(first) && (0, node_fs_1.existsSync)(`${first}.pub`));
    const pub = (0, sshKeyOps_1.readPublicKey)(first);
    node_assert_1.default.deepStrictEqual([pub.type, pub.comment], ['ssh-ed25519', 'ada@uni.example']);
    const second = await (0, sshKeyOps_1.generateKey)(input);
    node_assert_1.default.strictEqual(second, node_path_1.default.join((0, sshKey_1.managedKeyDir)(home), 'git.uni.example_ada_2_ed25519'));
    node_assert_1.default.ok((0, node_fs_1.existsSync)(first), 'the first key is untouched');
});
(0, node_test_1.test)('fingerprintOf reads the SHA256 fingerprint; readPublicKey names the missing .pub', real, async () => {
    const key = await (0, sshKeyOps_1.generateKey)({ ...input, username: 'fp' });
    node_assert_1.default.match((await (0, sshKeyOps_1.fingerprintOf)(key)) ?? '', /^SHA256:/);
    node_assert_1.default.throws(() => (0, sshKeyOps_1.readPublicKey)(node_path_1.default.join(home, 'no-such-key')), /no public key/i);
});
(0, node_test_1.test)('canSign accepts a passphrase-less key', real, async () => {
    const key = await (0, sshKeyOps_1.generateKey)({ ...input, username: 'signer' });
    node_assert_1.default.deepStrictEqual(await (0, sshKeyOps_1.canSign)(key), { ok: true, message: 'ok' });
});
(0, node_test_1.test)('canSign refuses a key with a passphrase, with the reason and the fix', real, async () => {
    const locked = node_path_1.default.join(home, 'id_locked');
    (0, node_child_process_1.execFileSync)('ssh-keygen', ['-t', 'ed25519', '-N', 'hunter2', '-f', locked, '-q']);
    const result = await (0, sshKeyOps_1.canSign)(locked);
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.match(result.message, /passphrase/);
    node_assert_1.default.match(result.message, /ssh-keygen -p/);
});
(0, node_test_1.test)('canSign explains an OpenSSH too old to sign, and a missing ssh-keygen', async () => {
    const oldSsh = async (_cmd, args) => args[0] === '-y' ? { code: 0, stdout: 'ssh-ed25519 AAAA', stderr: '' } : { code: 255, stdout: '', stderr: 'unknown option -- Y' };
    const old = await (0, sshKeyOps_1.canSign)('/k/id', oldSsh);
    node_assert_1.default.strictEqual(old.ok, false);
    node_assert_1.default.match(old.message, /OpenSSH 8\.0/);
    const missing = async () => ({ code: tool_1.TOOL_UNAVAILABLE, stdout: '', stderr: 'spawn ssh-keygen ENOENT' });
    node_assert_1.default.match((await (0, sshKeyOps_1.canSign)('/k/id', missing)).message, /not found on your PATH/);
    await node_assert_1.default.rejects((0, sshKeyOps_1.generateKey)(input, missing), /not found on your PATH/);
});
(0, node_test_1.test)('deleteManagedKey removes a managed pair, and refuses everything else — including paths that climb out', real, async () => {
    const managed = await (0, sshKeyOps_1.generateKey)({ ...input, username: 'doomed' });
    (0, sshKeyOps_1.deleteManagedKey)(managed, home);
    node_assert_1.default.ok(!(0, node_fs_1.existsSync)(managed) && !(0, node_fs_1.existsSync)(`${managed}.pub`));
    const own = node_path_1.default.join(home, '.ssh', 'id_ed25519');
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(own), { recursive: true });
    (0, node_fs_1.writeFileSync)(own, 'my own key');
    node_assert_1.default.throws(() => (0, sshKeyOps_1.deleteManagedKey)(own, home), /not a key Null IDE created/);
    // Not path.join: that would normalise the `..` away before the function ever sees it.
    node_assert_1.default.throws(() => (0, sshKeyOps_1.deleteManagedKey)(`${(0, sshKey_1.managedKeyDir)(home)}${node_path_1.default.sep}..${node_path_1.default.sep}id_ed25519`, home), /not a key Null IDE created/);
    node_assert_1.default.ok((0, node_fs_1.existsSync)(own), "the user's own key is still there");
});
//# sourceMappingURL=sshKeyOps.test.js.map