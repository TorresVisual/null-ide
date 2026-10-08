'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.sshKeyFile = void 0;
exports.expandKeyPath = expandKeyPath;
exports.credentialFor = credentialFor;
exports.planFor = planFor;
/** "~/.ssh/id" -> "<home>/.ssh/id"; backslashes become slashes (git runs `core.sshCommand` through a POSIX shell). */
function expandKeyPath(raw, home) {
    const trimmed = raw.trim();
    const expanded = /^~[\\/]/.test(trimmed) ? `${home.replace(/[\\/]+$/, '')}/${trimmed.slice(2)}` : trimmed;
    return expanded.replace(/\\/g, '/');
}
const sshKeyFile = (account, home) => expandKeyPath(account.sshKeyPath ?? '', home);
exports.sshKeyFile = sshKeyFile;
/** The credential entry for a token account (GitHub OAuth, GitLab OAuth or access token); SSH accounts have none. */
function credentialFor(account) {
    return account.authMethod === 'ssh' ? undefined : { host: account.host, username: account.username };
}
// Single quotes: the shell expands nothing inside them, so a key path can't smuggle in a command.
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
function planFor(account, home) {
    const config = [
        { key: 'user.name', value: account.username },
        { key: 'user.email', value: account.email },
    ];
    if (account.authMethod === 'ssh') {
        config.push({ key: 'core.sshCommand', value: `ssh -i ${shellQuote((0, exports.sshKeyFile)(account, home))} -o IdentitiesOnly=yes` });
        return { config };
    }
    // The URL form of the key is the documented one and scopes the username to https remotes on this host.
    config.push({ key: `credential.https://${account.host}.username`, value: account.username });
    return { config, credential: credentialFor(account) };
}
//# sourceMappingURL=gitPlan.js.map