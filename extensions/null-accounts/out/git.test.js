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
//# sourceMappingURL=git.test.js.map