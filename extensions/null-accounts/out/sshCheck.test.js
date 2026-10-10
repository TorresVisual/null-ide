'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const sshCheck_1 = require("./sshCheck");
(0, node_test_1.test)('GitLab and GitHub greetings are a success that names the user the key belongs to', () => {
    node_assert_1.default.deepStrictEqual((0, sshCheck_1.interpretSshReply)('Welcome to GitLab, @ada!\n', 'gitlab.uni.example'), {
        ok: true, user: 'ada', message: 'Connected to gitlab.uni.example as ada.',
    });
    const hub = (0, sshCheck_1.interpretSshReply)("Hi ada! You've successfully authenticated, but GitHub does not provide shell access.", 'github.com');
    node_assert_1.default.deepStrictEqual([hub.ok, hub.user], [true, 'ada']);
});
(0, node_test_1.test)('the common failures each get a message that says what to do', () => {
    node_assert_1.default.match((0, sshCheck_1.interpretSshReply)('Host key verification failed.', 'g.example').message, /ssh git@g\.example/);
    node_assert_1.default.match((0, sshCheck_1.interpretSshReply)('git@g.example: Permission denied (publickey).', 'g.example').message, /did not accept this key/);
    node_assert_1.default.match((0, sshCheck_1.interpretSshReply)('spawn ssh ENOENT', 'g.example').message, /not found on your PATH/);
    node_assert_1.default.strictEqual((0, sshCheck_1.interpretSshReply)('ssh: connect to host g.example port 22: Connection timed out', 'g.example').message, 'ssh: connect to host g.example port 22: Connection timed out');
    node_assert_1.default.strictEqual((0, sshCheck_1.interpretSshReply)('  \n', 'g.example').message, 'Could not reach g.example over SSH.');
    node_assert_1.default.strictEqual((0, sshCheck_1.interpretSshReply)('Permission denied', 'g.example').ok, false);
});
(0, node_test_1.test)('checkSsh asks ssh to use only this key, never to prompt, and passes the key as one argument', async () => {
    let seen = [];
    const check = await (0, sshCheck_1.checkSsh)('g.example', 'C:/Users/me/.ssh/id uni', async (args) => { seen = args; return 'Welcome to GitLab, @ada!'; });
    node_assert_1.default.strictEqual(check.ok, true);
    node_assert_1.default.deepStrictEqual(seen, (0, sshCheck_1.sshCheckArgs)('g.example', 'C:/Users/me/.ssh/id uni'));
    node_assert_1.default.ok(seen.includes('BatchMode=yes') && seen.includes('IdentitiesOnly=yes'));
    node_assert_1.default.strictEqual(seen[seen.indexOf('-i') + 1], 'C:/Users/me/.ssh/id uni');
    node_assert_1.default.strictEqual(seen.at(-1), 'git@g.example');
});
(0, node_test_1.test)('describeSshTest: success is informational; a failure or another user\'s key is a warning', () => {
    const ada = { username: 'ada', host: 'g.example' };
    node_assert_1.default.deepStrictEqual((0, sshCheck_1.describeSshTest)(ada, { ok: true, user: 'Ada', message: 'Connected to g.example as Ada.' }), { level: 'info', text: 'Connected to g.example as Ada. Git in projects using ada@g.example will use this key.' });
    node_assert_1.default.deepStrictEqual((0, sshCheck_1.describeSshTest)(ada, { ok: false, message: 'did not accept this key' }), { level: 'warn', text: 'The SSH test for ada@g.example failed: did not accept this key' });
    const other = (0, sshCheck_1.describeSshTest)(ada, { ok: true, user: 'bob', message: 'Connected to g.example as bob.' });
    node_assert_1.default.strictEqual(other.level, 'warn');
    node_assert_1.default.match(other.text, /belongs to bob, not ada/);
});
//# sourceMappingURL=sshCheck.test.js.map