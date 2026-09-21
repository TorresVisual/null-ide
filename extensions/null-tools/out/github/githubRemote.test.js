'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubRemote_1 = require("./githubRemote");
(0, node_test_1.default)('parseGithubRemote handles https remotes', () => {
    node_assert_1.default.deepStrictEqual((0, githubRemote_1.parseGithubRemote)('https://github.com/TorresVisual/null-ide.git\n'), { owner: 'TorresVisual', repo: 'null-ide' });
    node_assert_1.default.deepStrictEqual((0, githubRemote_1.parseGithubRemote)('https://github.com/TorresVisual/null-ide'), { owner: 'TorresVisual', repo: 'null-ide' });
});
(0, node_test_1.default)('parseGithubRemote handles ssh remotes', () => {
    node_assert_1.default.deepStrictEqual((0, githubRemote_1.parseGithubRemote)('git@github.com:TorresVisual/null-ide.git\n'), { owner: 'TorresVisual', repo: 'null-ide' });
});
(0, node_test_1.default)('parseGithubRemote returns null for non-GitHub or malformed remotes', () => {
    node_assert_1.default.strictEqual((0, githubRemote_1.parseGithubRemote)('https://gitlab.com/foo/bar.git'), null);
    node_assert_1.default.strictEqual((0, githubRemote_1.parseGithubRemote)('git@bitbucket.org:foo/bar.git'), null);
    node_assert_1.default.strictEqual((0, githubRemote_1.parseGithubRemote)('not a url'), null);
    node_assert_1.default.strictEqual((0, githubRemote_1.parseGithubRemote)(''), null);
});
//# sourceMappingURL=githubRemote.test.js.map