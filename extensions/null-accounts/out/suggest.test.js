'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const suggest_1 = require("./suggest");
const gh = (username) => ({ id: username, provider: 'github', host: 'github.com', username, email: `${username}@e.com`, authMethod: 'oauth' });
const gl = { id: 'tanuki', provider: 'gitlab', host: 'gitlab.example.org', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const glPort = { ...gl, id: 'tanuki8443', host: 'gitlab.example.org:8443' };
(0, node_test_1.test)('parseRemoteUrl reads https, ssh:// and scp-style remotes', () => {
    node_assert_1.default.deepStrictEqual((0, suggest_1.parseRemoteUrl)('https://github.com/octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
    node_assert_1.default.deepStrictEqual((0, suggest_1.parseRemoteUrl)('git@github.com:octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
    node_assert_1.default.deepStrictEqual((0, suggest_1.parseRemoteUrl)('ssh://git@gitlab.example.org:2222/team/app.git'), { host: 'gitlab.example.org', owner: 'team' });
    node_assert_1.default.deepStrictEqual((0, suggest_1.parseRemoteUrl)('https://GitLab.Example.org:8443/team/app'), { host: 'gitlab.example.org:8443', owner: 'team' });
});
(0, node_test_1.test)('parseRemoteUrl keeps an https login but never a password', () => {
    node_assert_1.default.deepStrictEqual((0, suggest_1.parseRemoteUrl)('https://hubot:s3cret@github.com/acme/app.git'), { host: 'github.com', owner: 'acme', user: 'hubot' });
});
(0, node_test_1.test)('parseRemoteUrl returns undefined for local paths, http and junk', () => {
    for (const bad of ['C:\\repos\\app', 'C:/repos/app', '/srv/git/app.git', 'http://github.com/a/b', '', 'not a url']) {
        node_assert_1.default.strictEqual((0, suggest_1.parseRemoteUrl)(bad), undefined, `expected "${bad}" to be rejected`);
    }
});
(0, node_test_1.test)('suggestAccount prefers the embedded login, then the owner', () => {
    const accounts = [gh('octocat'), gh('hubot'), gl];
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('git@github.com:HuBot/app.git', accounts)?.id, 'hubot');
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('https://octocat@github.com/hubot/app.git', accounts)?.id, 'octocat');
});
(0, node_test_1.test)('suggestAccount falls back to the only account on the host, but not when that is ambiguous', () => {
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('git@gitlab.example.org:team/app.git', [gh('octocat'), gl])?.id, 'tanuki');
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('git@github.com:acme/app.git', [gh('octocat'), gh('hubot')]), undefined);
});
(0, node_test_1.test)('suggestAccount needs the host (including an https port) to match', () => {
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('https://gitlab.example.org:8443/team/app', [glPort])?.id, 'tanuki8443');
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('https://gitlab.example.org/team/app', [glPort]), undefined);
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('git@bitbucket.org:team/app.git', [gh('octocat')]), undefined);
    node_assert_1.default.strictEqual((0, suggest_1.suggestAccount)('not a url', [gh('octocat')]), undefined);
});
//# sourceMappingURL=suggest.test.js.map