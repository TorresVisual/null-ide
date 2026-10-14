'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusyFlag = exports.GitError = void 0;
exports.makeRunGit = makeRunGit;
const child_process_1 = require("child_process");
class GitError extends Error {
    stderr;
    code;
    constructor(message, stderr, code) {
        super(message);
        this.stderr = stderr;
        this.code = code;
        this.name = 'GitError';
    }
}
exports.GitError = GitError;
// GIT_OPTIONAL_LOCKS=0: background reads never take index.lock, so they cannot make the user's own commit fail.
// GIT_EDITOR=true: `--continue` never blocks on an editor. LC_ALL=C: stable English messages.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' };
/** The only place the graph spawns git. Reads use the 15 s default; actions pass a longer timeout. */
function makeRunGit(cwd, timeoutMs = 15_000) {
    return (args) => new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (!err) {
                resolve(stdout);
                return;
            }
            const text = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join('\n') || err.message;
            reject(new GitError(text, stderr, err.code));
        });
    });
}
/** One action at a time per repo. Reads wait for the running action with whenIdle(). */
class BusyFlag {
    current;
    get busy() {
        return this.current !== undefined;
    }
    async run(fn) {
        if (this.current)
            return { ran: false };
        const running = fn();
        this.current = running;
        try {
            return { ran: true, value: await running };
        }
        finally {
            this.current = undefined;
        }
    }
    async whenIdle() {
        while (this.current) {
            try {
                await this.current;
            }
            catch { /* the action reports its own failure */ }
        }
    }
}
exports.BusyFlag = BusyFlag;
//# sourceMappingURL=gitRun.js.map