'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSshHost = normalizeSshHost;
exports.checkKeyPath = checkKeyPath;
exports.buildSshAccount = buildSshAccount;
const accountInput_1 = require("./accountInput");
const gitPlan_1 = require("./gitPlan");
/** A bare lowercase host for an SSH account. No port: ssh takes it from the remote URL, and `suggest` matches on the bare host. */
function normalizeSshHost(input) {
    const host = (0, accountInput_1.normalizeHost)(input);
    if (host.includes(':')) {
        throw new Error('Enter the host name without a port; SSH takes the port from the repository URL.');
    }
    return host;
}
/** Why this file can't be an account's key, or `undefined` if it can. */
function checkKeyPath(keyPath, home, exists) {
    const raw = keyPath.trim();
    if (!raw) {
        return 'Choose the private key file.';
    }
    if (/\.pub$/i.test(raw)) {
        return 'That is the public key (.pub). Choose the private key next to it, the file without .pub.';
    }
    return exists((0, gitPlan_1.expandKeyPath)(raw, home)) ? undefined : `There is no file at ${raw}.`;
}
/** GitHub for github.com, GitLab for every other host. Throws an Error with a message fit to show the user. */
function buildSshAccount(input, home, exists) {
    const host = normalizeSshHost(input.host);
    const problem = checkKeyPath(input.keyPath, home, exists);
    if (problem) {
        throw new Error(problem);
    }
    return (0, accountInput_1.validateNewAccount)({
        provider: host === 'github.com' ? 'github' : 'gitlab',
        host,
        username: input.username,
        email: input.email,
        authMethod: 'ssh',
        sshKeyPath: input.keyPath,
    });
}
//# sourceMappingURL=sshAccount.js.map