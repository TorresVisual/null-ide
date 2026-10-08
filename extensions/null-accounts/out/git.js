'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGit = exports.GIT_UNAVAILABLE = void 0;
exports.originUrl = originUrl;
const node_child_process_1 = require("node:child_process");
/** The `origin` remote URL of the repo at `cwd`; undefined if it isn't a repo, has no origin, or git is missing. */
function originUrl(cwd) {
    return new Promise(resolve => {
        (0, node_child_process_1.execFile)('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
            resolve(err ? undefined : stdout.trim() || undefined);
        });
    });
}
/** `GitResult.code` when git could not be started at all: not installed, or `cwd` does not exist. */
exports.GIT_UNAVAILABLE = -1;
const runGit = (cwd, args, input) => new Promise(resolve => {
    const child = (0, node_child_process_1.execFile)('git', args, { cwd, timeout: 10_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
        if (!err) {
            resolve({ code: 0, stdout, stderr });
            return;
        }
        // A non-zero exit has a numeric `code`; a failure to start git has a string one ('ENOENT') or none.
        const code = err.code;
        resolve({ code: typeof code === 'number' ? code : exports.GIT_UNAVAILABLE, stdout, stderr: stderr || err.message });
    });
    child.stdin?.on('error', () => { });
    child.stdin?.end(input ?? '');
});
exports.runGit = runGit;
//# sourceMappingURL=git.js.map