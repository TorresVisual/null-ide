'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountInput_1 = require("./accountInput");
const base = {
    provider: 'github',
    host: 'github.com',
    username: 'octocat',
    email: 'octocat@example.com',
    authMethod: 'oauth',
};
(0, node_test_1.test)('normalizeHost lowercases and strips scheme, trailing slashes and whitespace', () => {
    node_assert_1.default.strictEqual((0, accountInput_1.normalizeHost)('  https://GitLab.com/ '), 'gitlab.com');
    node_assert_1.default.strictEqual((0, accountInput_1.normalizeHost)('GitHub.com'), 'github.com');
});
(0, node_test_1.test)('normalizeHost keeps an explicit port', () => {
    node_assert_1.default.strictEqual((0, accountInput_1.normalizeHost)('gitlab.example.org:8443'), 'gitlab.example.org:8443');
});
(0, node_test_1.test)('normalizeHost rejects http://', () => {
    node_assert_1.default.throws(() => (0, accountInput_1.normalizeHost)('http://gitlab.example.org'), /http/i);
    node_assert_1.default.throws(() => (0, accountInput_1.normalizeHost)('HTTP://gitlab.example.org'), /http/i);
});
(0, node_test_1.test)('normalizeHost rejects empty input, paths, spaces and bad ports', () => {
    for (const bad of ['', '   ', 'https://', 'gitlab.com/group', 'git lab.com', 'gitlab.com:abc', 'ftp://gitlab.com']) {
        node_assert_1.default.throws(() => (0, accountInput_1.normalizeHost)(bad), `expected "${bad}" to be rejected`);
    }
});
(0, node_test_1.test)('validateNewAccount trims fields and normalises the host', () => {
    const out = (0, accountInput_1.validateNewAccount)({ ...base, host: ' https://GitHub.com/ ', username: '  octocat ', email: ' octocat@example.com ' });
    node_assert_1.default.deepStrictEqual(out, base);
});
(0, node_test_1.test)('validateNewAccount rejects a blank username or an email without @', () => {
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, username: '   ' }), /username/i);
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, email: 'nope' }), /email/i);
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, email: '' }), /email/i);
});
(0, node_test_1.test)('validateNewAccount rejects unknown provider and auth method', () => {
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, provider: 'bitbucket' }), /provider/i);
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, authMethod: 'magic' }), /auth/i);
});
(0, node_test_1.test)('validateNewAccount requires an SSH key path for ssh accounts, and keeps one on any other account', () => {
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, authMethod: 'ssh' }), /ssh key/i);
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, authMethod: 'ssh', sshKeyPath: '  ' }), /ssh key/i);
    node_assert_1.default.strictEqual((0, accountInput_1.validateNewAccount)({ ...base, authMethod: 'ssh', sshKeyPath: ' C:/keys/id_ed25519 ' }).sshKeyPath, 'C:/keys/id_ed25519');
    // A token account may carry a key too: git pushes over SSH with it while the token serves the API.
    node_assert_1.default.strictEqual((0, accountInput_1.validateNewAccount)({ ...base, sshKeyPath: ' C:/keys/id_ed25519 ' }).sshKeyPath, 'C:/keys/id_ed25519');
    node_assert_1.default.strictEqual('sshKeyPath' in (0, accountInput_1.validateNewAccount)({ ...base, sshKeyPath: '  ' }), false);
    node_assert_1.default.strictEqual('sshKeyPath' in (0, accountInput_1.validateNewAccount)(base), false);
});
(0, node_test_1.test)('signCommits needs a key, and is stored only when true', () => {
    node_assert_1.default.throws(() => (0, accountInput_1.validateNewAccount)({ ...base, signCommits: true }), /signing needs an ssh key/i);
    node_assert_1.default.strictEqual((0, accountInput_1.validateNewAccount)({ ...base, sshKeyPath: '/k/id', signCommits: true }).signCommits, true);
    node_assert_1.default.strictEqual('signCommits' in (0, accountInput_1.validateNewAccount)({ ...base, sshKeyPath: '/k/id', signCommits: false }), false);
});
(0, node_test_1.test)('validateNewAccount keeps a trimmed externalId and drops a blank one', () => {
    node_assert_1.default.strictEqual((0, accountInput_1.validateNewAccount)({ ...base, externalId: ' 583231 ' }).externalId, '583231');
    node_assert_1.default.strictEqual('externalId' in (0, accountInput_1.validateNewAccount)({ ...base, externalId: '  ' }), false);
});
//# sourceMappingURL=accountInput.test.js.map