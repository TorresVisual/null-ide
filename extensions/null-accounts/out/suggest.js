'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRemoteUrl = parseRemoteUrl;
exports.suggestAccount = suggestAccount;
const URL_RE = /^(https|ssh|git):\/\/(?:([^@/\s]+)@)?([^/:\s@]+)(:\d+)?\/([^/\s]+)\/\S+$/i;
// Host needs 2+ characters so a Windows drive path like "C:/repos/app" is not read as host "C".
const SCP_RE = /^(?:[^@/\s]+@)?([^:/\s]{2,}):([^/\s]+)\/\S+$/;
function parseRemoteUrl(raw) {
    const url = raw.trim();
    const m = URL_RE.exec(url);
    if (m) {
        const [, scheme, login, host, port, owner] = m;
        const https = scheme.toLowerCase() === 'https';
        const ref = { host: host.toLowerCase() + (https && port ? port : ''), owner };
        if (https && login) {
            ref.user = login.split(':')[0];
        }
        return ref;
    }
    const s = SCP_RE.exec(url);
    return s ? { host: s[1].toLowerCase(), owner: s[2] } : undefined;
}
/** The account that best matches a repo's origin URL, or undefined. Only a suggestion: the user confirms it. */
function suggestAccount(originUrl, accounts) {
    const remote = parseRemoteUrl(originUrl);
    if (!remote) {
        return undefined;
    }
    const onHost = accounts.filter(a => a.host === remote.host);
    const named = (name) => name ? onHost.find(a => a.username.toLowerCase() === name.toLowerCase()) : undefined;
    return named(remote.user) ?? named(remote.owner) ?? (onHost.length === 1 ? onHost[0] : undefined);
}
//# sourceMappingURL=suggest.js.map