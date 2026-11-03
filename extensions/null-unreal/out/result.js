"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exitCodeOf = exitCodeOf;
exports.formatResult = formatResult;
exports.parseLogPath = parseLogPath;
// Shared by the CLI and the extension: the two result lines are the whole contract.
// A killed process (no exit code) is 255, never 0.
function exitCodeOf(r) {
    if (r.timedOut)
        return 124;
    return r.code ?? 255;
}
function formatResult(cmd, r, logPath, warning) {
    const secs = Math.round(r.seconds);
    const head = r.timedOut
        ? `null-unreal ${cmd}: timed out after ${secs}s`
        : `null-unreal ${cmd}: exit ${exitCodeOf(r)} in ${secs}s`;
    const log = logPath !== undefined ? `log: ${logPath}` : `log: not kept (${warning ?? 'unknown'})`;
    return `${head}\n${log}`;
}
function parseLogPath(output) {
    for (const line of output.split(/\r?\n/)) {
        const m = /^log: (?!not kept)(.+)$/.exec(line);
        if (m)
            return m[1];
    }
    return undefined;
}
//# sourceMappingURL=result.js.map