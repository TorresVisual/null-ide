'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const sshAccount_1 = require("./sshAccount");
const present = new Set(['/home/me/.ssh/id_uni', 'C:/Users/me/.ssh/id_uni']);
const exists = (file) => present.has(file);
const input = { host: 'GitLab.Uni.example', username: ' ada ', email: 'ada@uni.example', keyPath: '~/.ssh/id_uni' };
(0, node_test_1.test)('a university GitLab account: GitLab provider, bare host, ssh auth, key path kept as typed', () => {
    node_assert_1.default.deepStrictEqual((0, sshAccount_1.buildSshAccount)(input, '/home/me', exists), {
        provider: 'gitlab', host: 'gitlab.uni.example', username: 'ada', email: 'ada@uni.example',
        authMethod: 'ssh', sshKeyPath: '~/.ssh/id_uni',
    });
});
(0, node_test_1.test)('github.com over SSH is a GitHub account', () => {
    node_assert_1.default.strictEqual((0, sshAccount_1.buildSshAccount)({ ...input, host: 'https://github.com/' }, '/home/me', exists).provider, 'github');
});
(0, node_test_1.test)('a Windows key path is found after expansion, whichever way the slashes lean', () => {
    const win = { ...input, keyPath: 'C:\\Users\\me\\.ssh\\id_uni' };
    node_assert_1.default.strictEqual((0, sshAccount_1.buildSshAccount)(win, 'C:\\Users\\me', exists).sshKeyPath, 'C:\\Users\\me\\.ssh\\id_uni');
});
(0, node_test_1.test)('the key path is checked: empty, the .pub half of a pair, and a file that is not there', () => {
    node_assert_1.default.match((0, sshAccount_1.checkKeyPath)('  ', '/home/me', exists) ?? '', /Choose the private key/);
    node_assert_1.default.match((0, sshAccount_1.checkKeyPath)('~/.ssh/id_uni.pub', '/home/me', exists) ?? '', /public key/);
    node_assert_1.default.match((0, sshAccount_1.checkKeyPath)('~/.ssh/nope', '/home/me', exists) ?? '', /no file at ~\/\.ssh\/nope/);
    node_assert_1.default.strictEqual((0, sshAccount_1.checkKeyPath)('~/.ssh/id_uni', '/home/me', exists), undefined);
});
(0, node_test_1.test)('a host with a port, an http:// host, or a bad email is refused with a readable message', () => {
    node_assert_1.default.throws(() => (0, sshAccount_1.normalizeSshHost)('git.uni.example:2222'), /without a port/);
    node_assert_1.default.throws(() => (0, sshAccount_1.buildSshAccount)({ ...input, host: 'http://git.uni.example' }, '/home/me', exists), /http/);
    node_assert_1.default.throws(() => (0, sshAccount_1.buildSshAccount)({ ...input, email: 'not-an-email' }, '/home/me', exists), /email/i);
    node_assert_1.default.throws(() => (0, sshAccount_1.buildSshAccount)({ ...input, keyPath: '~/.ssh/nope' }, '/home/me', exists), /no file/);
});
//# sourceMappingURL=sshAccount.test.js.map