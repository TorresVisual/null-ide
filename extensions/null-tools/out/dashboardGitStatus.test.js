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
const dashboardGitStatus_1 = require("./dashboardGitStatus");
function initRepo() {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'dashboard-git-test-'));
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
(0, node_test_1.default)('computeGitStatuses reports branch and clean status for a committed repo', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'initial');
    const results = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)([dir], (p, status) => results.set(p, status));
    const status = results.get(dir);
    node_assert_1.default.ok(status);
    node_assert_1.default.strictEqual(status.dirty, false);
    node_assert_1.default.match(status.branch, /^(main|master)$/);
});
(0, node_test_1.default)('computeGitStatuses reports dirty for uncommitted changes', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'initial');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'changed');
    const results = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)([dir], (p, status) => results.set(p, status));
    node_assert_1.default.strictEqual(results.get(dir).dirty, true);
});
(0, node_test_1.default)('computeGitStatuses returns null for a non-git directory without blocking others', async () => {
    const gitDir = initRepo();
    commit(gitDir, 'a.txt', 'initial');
    const nonGitDir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'dashboard-nongit-test-'));
    const results = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)([nonGitDir, gitDir], (p, status) => results.set(p, status));
    node_assert_1.default.strictEqual(results.get(nonGitDir), null);
    node_assert_1.default.ok(results.get(gitDir));
});
(0, node_test_1.default)('computeGitStatuses never exceeds the configured concurrency cap', async () => {
    let inFlight = 0, peak = 0;
    const fakeFetch = async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 20));
        inFlight--;
        return { branch: 'main', dirty: false };
    };
    const paths = Array.from({ length: 10 }, (_, i) => `fake-${i}`);
    await (0, dashboardGitStatus_1.computeGitStatuses)(paths, () => { }, 3, fakeFetch);
    node_assert_1.default.strictEqual(peak, 3);
});
(0, node_test_1.default)('computeGitStatuses isolates a failing fetch from the rest of the batch', async () => {
    const fakeFetch = async (cwd) => {
        if (cwd === 'bad')
            throw new Error('boom');
        return { branch: 'main', dirty: false };
    };
    const results = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)(['bad', 'good-1', 'good-2'], (p, s) => results.set(p, s), 2, fakeFetch);
    node_assert_1.default.strictEqual(results.get('bad'), null);
    node_assert_1.default.deepStrictEqual(results.get('good-1'), { branch: 'main', dirty: false });
    node_assert_1.default.deepStrictEqual(results.get('good-2'), { branch: 'main', dirty: false });
});
(0, node_test_1.default)('computeGitStatuses supports a custom status type via generics', async () => {
    const fakeFetch = async () => ({ note: 'ok' });
    const results = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)(['a'], (p, s) => results.set(p, s), 1, fakeFetch);
    node_assert_1.default.deepStrictEqual(results.get('a'), { note: 'ok' });
});
//# sourceMappingURL=dashboardGitStatus.test.js.map