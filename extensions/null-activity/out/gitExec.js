'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.execGit = execGit;
const child_process_1 = require("child_process");
/** The only place that spawns git. No shell; read-only use, so never take optional locks. Rejects on a non-zero exit, timeout or output over the cap. */
function execGit(args, cwd) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('git', args, { cwd, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
}
//# sourceMappingURL=gitExec.js.map