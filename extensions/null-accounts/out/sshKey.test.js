'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const sshKey_1 = require("./sshKey");
const HOME = node_path_1.default.resolve('/home/me');
(0, node_test_1.test)('keyFileName turns host and user into one file name that is safe on every OS', () => {
    node_assert_1.default.strictEqual((0, sshKey_1.keyFileName)('git.example.org:8443', 'Ada Lovelace'), 'git.example.org_8443_ada_lovelace');
    node_assert_1.default.strictEqual((0, sshKey_1.keyFileName)('github.com', '../../x'), 'github.com_.._.._x');
    node_assert_1.default.ok(!/[\\/:]/.test((0, sshKey_1.keyFileName)('a:b', 'c/d\\e')));
});
(0, node_test_1.test)('uniqueKeyPath never picks a file that is already there, key or .pub', () => {
    const dir = node_path_1.default.join(HOME, 'keys');
    const taken = new Set([node_path_1.default.join(dir, 'gh_ada_ed25519'), `${node_path_1.default.join(dir, 'gh_ada_2_ed25519')}.pub`]);
    const exists = (f) => taken.has(f);
    node_assert_1.default.strictEqual((0, sshKey_1.uniqueKeyPath)(dir, 'gh_ada', exists), node_path_1.default.join(dir, 'gh_ada_3_ed25519'));
    node_assert_1.default.strictEqual((0, sshKey_1.uniqueKeyPath)(dir, 'other', exists), node_path_1.default.join(dir, 'other_ed25519'));
});
(0, node_test_1.test)('keygenArgs is an argv: an empty passphrase and the comment are single elements, no shell involved', () => {
    node_assert_1.default.deepStrictEqual((0, sshKey_1.keygenArgs)('/k/id one', 'ada@uni.example'), ['-t', 'ed25519', '-f', '/k/id one', '-N', '', '-C', 'ada@uni.example', '-q']);
});
(0, node_test_1.test)('parsePublicKey reads type, key and comment from the first line', () => {
    const key = (0, sshKey_1.parsePublicKey)('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA ada@uni.example laptop\n');
    node_assert_1.default.deepStrictEqual(key, {
        type: 'ssh-ed25519', blob: 'AAAAC3NzaC1lZDI1NTE5AAAA', comment: 'ada@uni.example laptop',
        line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA ada@uni.example laptop',
    });
    node_assert_1.default.strictEqual((0, sshKey_1.parsePublicKey)('ssh-ed25519 AAAA').comment, '');
});
(0, node_test_1.test)('parsePublicKey refuses a private key and anything that is not a public key line', () => {
    node_assert_1.default.throws(() => (0, sshKey_1.parsePublicKey)('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY-----'), /private key/i);
    node_assert_1.default.throws(() => (0, sshKey_1.parsePublicKey)('hello world'), /not a public key/i);
    node_assert_1.default.throws(() => (0, sshKey_1.parsePublicKey)(''), /not a public key/i);
});
(0, node_test_1.test)('parseFingerprint finds the SHA256 fingerprint in ssh-keygen -l output', () => {
    node_assert_1.default.strictEqual((0, sshKey_1.parseFingerprint)('256 SHA256:Zk3q+Abc/def12 ada@uni.example (ED25519)\n'), 'SHA256:Zk3q+Abc/def12');
    node_assert_1.default.strictEqual((0, sshKey_1.parseFingerprint)('nonsense'), undefined);
});
(0, node_test_1.test)('keyTitle names the machine and the day, so keys can be told apart on the server', () => {
    node_assert_1.default.strictEqual((0, sshKey_1.keyTitle)('DESKTOP-1', new Date('2026-10-09T23:30:00Z')), 'Null IDE on DESKTOP-1 (2026-10-09)');
});
(0, node_test_1.test)('isManagedKey is true only inside ~/.ssh/null-accounts, whichever way the path is written', () => {
    const dir = (0, sshKey_1.managedKeyDir)(HOME);
    node_assert_1.default.strictEqual((0, sshKey_1.isManagedKey)(node_path_1.default.join(dir, 'gh_ada_ed25519'), HOME), true);
    node_assert_1.default.strictEqual((0, sshKey_1.isManagedKey)('~/.ssh/null-accounts/gh_ada_ed25519', HOME), true);
    node_assert_1.default.strictEqual((0, sshKey_1.isManagedKey)(node_path_1.default.join(HOME, '.ssh', 'id_ed25519'), HOME), false);
    node_assert_1.default.strictEqual((0, sshKey_1.isManagedKey)('~/.ssh/null-accounts/../id_ed25519', HOME), false);
    node_assert_1.default.strictEqual((0, sshKey_1.isManagedKey)(dir, HOME), false);
});
//# sourceMappingURL=sshKey.test.js.map