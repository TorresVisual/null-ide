'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
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
//# sourceMappingURL=git.js.map