'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStagedDiff = getStagedDiff;
exports.runClaude = runClaude;
const child_process_1 = require("child_process");
const PROMPT = 'Output ONLY a single git commit message for the staged diff below. ' +
    'No explanation. No preamble. No code block fences. No bullet points. No quotes. ' +
    'Use conventional commit format: type: short description ' +
    '(imperative mood, under 72 chars). ' +
    'Types: feat, fix, chore, refactor, docs, style, test. ' +
    'Your entire response must be exactly one line -- the commit message itself.\n\n' +
    'Staged diff:\n';
function getStagedDiff(cwd) {
    try {
        const staged = (0, child_process_1.execSync)('git diff --staged', { cwd, encoding: 'utf8', timeout: 10000 });
        if (staged.trim())
            return staged;
        return (0, child_process_1.execSync)('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
    }
    catch {
        return '';
    }
}
function runClaude(diff, cwd) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('claude', ['--print'], { cwd, shell: true, windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.stdin.write(PROMPT + diff);
        child.stdin.end();
        const timer = setTimeout(() => { child.kill(); reject(new Error('claude timed out after 30 s')); }, 30000);
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                const msg = out.trim();
                if (msg)
                    resolve(msg);
                else
                    reject(new Error(`claude produced no output (stderr: ${err.trim() || 'none'})`));
            }
            else {
                reject(new Error(err.trim() || `claude exited with code ${code}`));
            }
        });
    });
}
//# sourceMappingURL=commitMessage.js.map