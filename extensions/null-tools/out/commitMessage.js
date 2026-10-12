'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStagedDiff = getStagedDiff;
exports.getChangedFiles = getChangedFiles;
exports.heuristicMessage = heuristicMessage;
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
function getChangedFiles(cwd) {
    try {
        const staged = (0, child_process_1.execSync)('git diff --staged --name-status', { cwd, encoding: 'utf8', timeout: 10000 });
        if (staged.trim())
            return staged;
        return (0, child_process_1.execSync)('git diff HEAD --name-status', { cwd, encoding: 'utf8', timeout: 10000 });
    }
    catch {
        return '';
    }
}
/** Offline fallback when claude is unavailable: builds a message from `git diff --name-status` output. */
function heuristicMessage(nameStatus) {
    const files = nameStatus.split('\n').filter(l => l.trim()).map(l => {
        const [status, ...paths] = l.split('\t');
        return { status: status[0], path: paths[paths.length - 1] };
    });
    if (!files.length)
        return 'chore: update files';
    const all = (re) => files.every(f => re.test(f.path));
    const type = all(/\.(md|mdx|txt)$|(^|\/)docs\//i) ? 'docs' : all(/\.(test|spec)\.|(^|\/)tests?\//i) ? 'test' : 'chore';
    const verb = files.every(f => f.status === 'A') ? 'add' : files.every(f => f.status === 'D') ? 'remove' : 'update';
    const names = files.map(f => f.path.split('/').pop());
    return `${type}: ${verb} ${files.length <= 3 ? names.join(', ') : `${files.length} files`}`;
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