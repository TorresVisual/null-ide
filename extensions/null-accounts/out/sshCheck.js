'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSsh = void 0;
exports.sshCheckArgs = sshCheckArgs;
exports.interpretSshReply = interpretSshReply;
exports.describeSshTest = describeSshTest;
exports.checkSsh = checkSsh;
const node_child_process_1 = require("node:child_process");
const runSsh = args => new Promise(resolve => {
    (0, node_child_process_1.execFile)('ssh', args, { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
        resolve(`${stdout}\n${stderr}\n${err && !stdout && !stderr ? err.message : ''}`);
    });
});
exports.runSsh = runSsh;
/** `-T git@host` with only this key; BatchMode so it fails fast instead of waiting on a prompt nobody can see. */
function sshCheckArgs(host, keyFile) {
    return ['-i', keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', `git@${host}`];
}
// GitLab: "Welcome to GitLab, @ada!". GitHub: "Hi ada! You've successfully authenticated, but GitHub does not provide shell access."
const WELCOME = /welcome to gitlab, @?([\w.-]+)!|hi ([\w.-]+)! you've successfully authenticated/i;
function interpretSshReply(output, host) {
    const welcome = WELCOME.exec(output);
    if (welcome) {
        const user = welcome[1] ?? welcome[2];
        return { ok: true, user, message: `Connected to ${host} as ${user}.` };
    }
    const fail = (message) => ({ ok: false, message });
    if (/ENOENT/.test(output)) {
        return fail('ssh was not found on your PATH.');
    }
    if (/host key verification failed|authenticity of host/i.test(output)) {
        return fail(`${host} is not in your known hosts yet. Run  ssh git@${host}  once in a terminal and accept its fingerprint, then try again.`);
    }
    if (/permission denied/i.test(output)) {
        return fail(`${host} did not accept this key. Is its public key (.pub) added to your account there?`);
    }
    const firstLine = output.split(/\r?\n/).map(l => l.trim()).find(Boolean);
    return fail(firstLine ?? `Could not reach ${host} over SSH.`);
}
/** What to tell the user after a test: informational when it worked as expected, a warning otherwise. */
function describeSshTest(account, check) {
    const who = `${account.username}@${account.host}`;
    if (!check.ok) {
        return { level: 'warn', text: `The SSH test for ${who} failed: ${check.message}` };
    }
    if (check.user && check.user.toLowerCase() !== account.username.toLowerCase()) {
        return { level: 'warn', text: `${account.host} says this key belongs to ${check.user}, not ${account.username}.` };
    }
    return { level: 'info', text: `${check.message} Git in projects using ${who} will use this key.` };
}
async function checkSsh(host, keyFile, run = exports.runSsh) {
    return interpretSshReply(await run(sshCheckArgs(host, keyFile)), host);
}
//# sourceMappingURL=sshCheck.js.map