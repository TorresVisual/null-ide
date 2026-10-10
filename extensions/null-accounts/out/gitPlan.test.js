'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const gitPlan_1 = require("./gitPlan");
const github = {
    id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
};
(0, node_test_1.test)('a token account gets its identity, a host-scoped credential username, and a credential-store entry', () => {
    node_assert_1.default.deepStrictEqual((0, gitPlan_1.planFor)(github, '/home/me'), {
        config: [
            { key: 'user.name', value: 'octocat' },
            { key: 'user.email', value: 'octo@example.com' },
            { key: 'credential.https://github.com.username', value: 'octocat' },
        ],
        credential: { host: 'github.com', username: 'octocat' },
    });
});
(0, node_test_1.test)('a self-hosted host keeps its port in the credential key and target', () => {
    const gitlab = { ...github, provider: 'gitlab', host: 'git.example.org:8443', username: 'eve', authMethod: 'https' };
    const plan = (0, gitPlan_1.planFor)(gitlab, '/home/me');
    node_assert_1.default.ok(plan.config.some(e => e.key === 'credential.https://git.example.org:8443.username' && e.value === 'eve'));
    node_assert_1.default.deepStrictEqual(plan.credential, { host: 'git.example.org:8443', username: 'eve' });
});
(0, node_test_1.test)('an SSH account sets core.sshCommand with the key in single quotes and no credential entry', () => {
    const ssh = { ...github, authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\id work' };
    const plan = (0, gitPlan_1.planFor)(ssh, 'C:\\Users\\me');
    node_assert_1.default.deepStrictEqual(plan.config.at(-1), {
        key: 'core.sshCommand', value: `ssh -i 'C:/Users/me/.ssh/id work' -o IdentitiesOnly=yes`,
    });
    node_assert_1.default.strictEqual(plan.credential, undefined);
    node_assert_1.default.strictEqual((0, gitPlan_1.credentialFor)(ssh), undefined);
});
(0, node_test_1.test)('~ in an SSH key path expands to the home directory, and a quote in the path cannot end the quoting', () => {
    const ssh = { ...github, authMethod: 'ssh', sshKeyPath: '~/.ssh/it\'s; rm -rf ~' };
    node_assert_1.default.strictEqual((0, gitPlan_1.sshKeyFile)(ssh, 'C:\\Users\\me\\'), `C:/Users/me/.ssh/it's; rm -rf ~`);
    node_assert_1.default.strictEqual((0, gitPlan_1.planFor)(ssh, '/home/me').config.at(-1)?.value, `ssh -i '/home/me/.ssh/it'\\''s; rm -rf ~' -o IdentitiesOnly=yes`);
});
(0, node_test_1.test)('an SSH account without a key path plans an empty key, which the caller reports as a missing file', () => {
    node_assert_1.default.strictEqual((0, gitPlan_1.sshKeyFile)({ ...github, authMethod: 'ssh' }, '/home/me'), '');
});
(0, node_test_1.test)('a token account with a key gets core.sshCommand as well as its credential entry', () => {
    const both = { ...github, sshKeyPath: '/k/id' };
    const plan = (0, gitPlan_1.planFor)(both, '/home/me');
    node_assert_1.default.deepStrictEqual(plan.config.map(e => e.key), ['user.name', 'user.email', 'core.sshCommand', 'credential.https://github.com.username']);
    node_assert_1.default.deepStrictEqual(plan.credential, { host: 'github.com', username: 'octocat' });
});
(0, node_test_1.test)('signCommits adds git SSH-signing settings that point at the private key, with plain separators and no quoting', () => {
    const signer = { ...github, authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\id work', signCommits: true };
    node_assert_1.default.deepStrictEqual((0, gitPlan_1.planFor)(signer, 'C:\\Users\\me').config.slice(3), [
        { key: 'gpg.format', value: 'ssh' },
        { key: 'user.signingkey', value: 'C:/Users/me/.ssh/id work' },
        { key: 'commit.gpgsign', value: 'true' },
    ]);
});
(0, node_test_1.test)('signCommits without a key plans no signing', () => {
    const stale = { ...github, signCommits: true };
    node_assert_1.default.ok(!(0, gitPlan_1.planFor)(stale, '/home/me').config.some(e => e.key === 'commit.gpgsign'));
});
(0, node_test_1.test)('user.name is the git name when the account has one, else the username', () => {
    const name = (a) => (0, gitPlan_1.planFor)(a, '/home/me').config.find(e => e.key === 'user.name')?.value;
    node_assert_1.default.strictEqual(name({ ...github, gitName: 'Octo Cat' }), 'Octo Cat');
    node_assert_1.default.strictEqual(name(github), 'octocat');
});
//# sourceMappingURL=gitPlan.test.js.map