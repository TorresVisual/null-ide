'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGitStatuses = computeGitStatuses;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function getGitStatus(cwd) {
    try {
        const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 });
        const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
        return { branch: branch.trim(), dirty: porcelain.trim().length > 0 };
    }
    catch {
        return null;
    }
}
/**
 * Computes git status for each path with at most `concurrency` shell-outs in
 * flight at once, calling onResult(path, status) as each one resolves (not
 * all at once) so the caller can update the UI progressively. A failing or
 * throwing fetch for one path never blocks or fails the rest of the batch.
 */
async function computeGitStatuses(paths, onResult, concurrency = 4, fetchStatus = getGitStatus) {
    let next = 0;
    async function worker() {
        while (next < paths.length) {
            const index = next++;
            const p = paths[index];
            let status;
            try {
                status = await fetchStatus(p);
            }
            catch {
                status = null;
            }
            onResult(p, status);
        }
    }
    const workerCount = Math.min(concurrency, paths.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
}
//# sourceMappingURL=dashboardGitStatus.js.map