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
const git_1 = require("./git");
(0, node_test_1.test)('originUrl reads origin from a real repo, and is undefined for a non-repo or a repo without origin', async () => {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'null-accounts-git-'));
    try {
        node_assert_1.default.strictEqual(await (0, git_1.originUrl)(dir), undefined);
        (0, node_child_process_1.execFileSync)('git', ['init', '-q'], { cwd: dir });
        node_assert_1.default.strictEqual(await (0, git_1.originUrl)(dir), undefined);
        (0, node_child_process_1.execFileSync)('git', ['remote', 'add', 'origin', 'git@github.com:octocat/hello.git'], { cwd: dir });
        node_assert_1.default.strictEqual(await (0, git_1.originUrl)(dir), 'git@github.com:octocat/hello.git');
    }
    finally {
        (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('runGit reports the exit code, feeds stdin, and tells "git could not start" apart from "git said no"', async () => {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'null-accounts-rungit-'));
    try {
        const notRepo = await (0, git_1.runGit)(dir, ['rev-parse', '--is-inside-work-tree']);
        node_assert_1.default.strictEqual(notRepo.code, 128);
        node_assert_1.default.notStrictEqual(notRepo.stderr, '');
        // The blob id of "hello\n" is fixed, so a matching id proves the input reached git's stdin.
        const hashed = await (0, git_1.runGit)(dir, ['hash-object', '--stdin'], 'hello\n');
        node_assert_1.default.deepStrictEqual([hashed.code, hashed.stdout.trim()], [0, 'ce013625030ba8dba906f756967f9e9ca394464a']);
        const gone = await (0, git_1.runGit)(node_path_1.default.join(dir, 'does-not-exist'), ['--version']);
        node_assert_1.default.strictEqual(gone.code, git_1.GIT_UNAVAILABLE);
    }
    finally {
        (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=git.test.js.map