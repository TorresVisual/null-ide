'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const gitBranch_1 = require("./gitBranch");
function initRepo() {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'gitBranch-test-'));
    (0, node_child_process_1.execFileSync)('git', ['init', '-q'], { cwd: dir });
    (0, node_child_process_1.execFileSync)('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    (0, node_child_process_1.execFileSync)('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return dir;
}
function commit(dir, file, message) {
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, file), file);
    (0, node_child_process_1.execFileSync)('git', ['add', file], { cwd: dir });
    (0, node_child_process_1.execFileSync)('git', ['commit', '-q', '-m', message], { cwd: dir });
}
(0, node_test_1.default)('branchNameForIssue slugifies the title and caps length', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(43, 'Add Issues Panel: split view!'), 'issue-43-add-issues-panel-split-view');
});
(0, node_test_1.default)('branchNameForIssue strips shell metacharacters entirely', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(7, '; rm -rf ~ && echo pwned $(whoami)'), 'issue-7-rm-rf-echo-pwned-whoami');
});
(0, node_test_1.default)('branchNameForIssue falls back to just the number for an empty slug', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(9, '!!!'), 'issue-9');
});
(0, node_test_1.default)('getLocallyClosedIssueNumbers returns empty set with no upstream configured', () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'Closes #52');
    node_assert_1.default.deepStrictEqual((0, gitBranch_1.getLocallyClosedIssueNumbers)(dir), new Set());
});
(0, node_test_1.default)('getLocallyClosedIssueNumbers finds closing keywords in unpushed commits', () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'initial');
    const bare = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'gitBranch-bare-'));
    (0, node_child_process_1.execFileSync)('git', ['init', '-q', '--bare'], { cwd: bare });
    (0, node_child_process_1.execFileSync)('git', ['remote', 'add', 'origin', bare], { cwd: dir });
    (0, node_child_process_1.execFileSync)('git', ['push', '-q', '-u', 'origin', 'HEAD:main'], { cwd: dir });
    node_assert_1.default.deepStrictEqual((0, gitBranch_1.getLocallyClosedIssueNumbers)(dir), new Set(), 'nothing unpushed yet');
    commit(dir, 'b.txt', 'Resolves #99 and fixes #7');
    node_assert_1.default.deepStrictEqual((0, gitBranch_1.getLocallyClosedIssueNumbers)(dir), new Set([99, 7]));
});
//# sourceMappingURL=gitBranch.test.js.map