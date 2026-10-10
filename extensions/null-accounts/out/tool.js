'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTool = exports.TOOL_UNAVAILABLE = void 0;
const node_child_process_1 = require("node:child_process");
/** `ToolResult.code` when the program could not run at all: not installed, killed by the timeout, or not startable. */
exports.TOOL_UNAVAILABLE = -1;
const runTool = (command, args, options = {}) => new Promise(resolve => {
    const child = (0, node_child_process_1.execFile)(command, args, { env: { ...process.env, ...options.env }, timeout: options.timeoutMs ?? 15_000, windowsHide: true }, (err, stdout, stderr) => {
        if (!err) {
            resolve({ code: 0, stdout, stderr });
            return;
        }
        // A non-zero exit has a numeric `code`; a failure to start has a string one ('ENOENT') or none.
        const code = err.code;
        resolve({ code: typeof code === 'number' ? code : exports.TOOL_UNAVAILABLE, stdout, stderr: stderr || err.message });
    });
    // Nothing will ever answer a prompt: end stdin so a tool that reads it stops waiting.
    child.stdin?.on('error', () => { });
    child.stdin?.end();
});
exports.runTool = runTool;
//# sourceMappingURL=tool.js.map