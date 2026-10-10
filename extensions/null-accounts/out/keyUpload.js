'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITHUB_KEY_SCOPES = exports.fetchPostJson = void 0;
exports.keySettingsUrl = keySettingsUrl;
exports.uploadPublicKey = uploadPublicKey;
/** The real `PostJson`. */
const fetchPostJson = async (url, headers, body) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'null-ide', ...headers },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed = text;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    }
    catch { /* keep the raw text */ }
    return { status: res.status, body: parsed };
};
exports.fetchPostJson = fetchPostJson;
/** What a GitHub sign-in needs to add keys; asked for together, so the user approves once. GitLab's `api` scope is already in its OAuth flow. */
exports.GITHUB_KEY_SCOPES = ['write:public_key', 'write:ssh_signing_key'];
/** Where to paste a public key by hand (accounts without a token). */
function keySettingsUrl(account) {
    return account.provider === 'github'
        ? 'https://github.com/settings/ssh/new'
        : `https://${account.host}/-/user_settings/ssh_keys`;
}
const DUPLICATE = /already (in use|been taken|exists)/i;
// GitHub answers a key it already has with 422, GitLab with 400.
const isDuplicate = (reply) => (reply.status === 422 || reply.status === 400)
    && DUPLICATE.test(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? ''));
function serverSays(reply) {
    const body = reply.body;
    const message = typeof body === 'string' ? body : body?.message;
    const text = typeof message === 'string' ? message : message === undefined ? '' : JSON.stringify(message);
    return text.slice(0, 200);
}
function refusal(provider, reply, permissionHint) {
    if (reply.status === 401 || reply.status === 403) {
        return { ok: false, message: `${provider} refused (HTTP ${reply.status}): ${permissionHint}` };
    }
    const says = serverSays(reply);
    return { ok: false, message: `${provider} answered HTTP ${reply.status}${says ? `: ${says}` : '.'}` };
}
const GITHUB_HINT = 'the sign-in cannot add SSH keys. Allow "write:public_key" and "write:ssh_signing_key" when asked, or add the key by hand.';
const GITLAB_HINT = 'the token needs the "api" scope to add SSH keys (read_api is not enough), or add the key by hand.';
/**
 * Adds the public key to the account on its server for pushing and for signing. A key the server already has is a
 * success. The token only ever goes in an Authorization header to the account's own host.
 */
async function uploadPublicKey(account, token, key, title, post = exports.fetchPostJson) {
    const line = `${key.type} ${key.blob}`; // the comment is the user's email: no reason to send it
    const headers = { Authorization: `Bearer ${token}` };
    try {
        if (account.provider === 'github') {
            const auth = await post('https://api.github.com/user/keys', { ...headers, Accept: 'application/vnd.github+json' }, { title, key: line });
            const authAdded = auth.status === 201;
            if (!authAdded && !isDuplicate(auth)) {
                return refusal('GitHub', auth, GITHUB_HINT);
            }
            const signing = await post('https://api.github.com/user/ssh_signing_keys', { ...headers, Accept: 'application/vnd.github+json' }, { title, key: line });
            const signingAdded = signing.status === 201;
            if (!signingAdded && !isDuplicate(signing)) {
                const failed = refusal('GitHub', signing, GITHUB_HINT);
                return { ok: false, message: `The key was added for pushing, but not as a signing key. ${failed.message}` };
            }
            return { ok: true, already: !authAdded && !signingAdded };
        }
        const reply = await post(`https://${account.host}/api/v4/user/keys`, headers, { title, key: line, usage_type: 'auth_and_signing' });
        if (reply.status === 201) {
            return { ok: true, already: false };
        }
        if (isDuplicate(reply)) {
            return { ok: true, already: true };
        }
        return refusal('GitLab', reply, GITLAB_HINT);
    }
    catch {
        return { ok: false, message: `Could not reach ${account.host}.` };
    }
}
//# sourceMappingURL=keyUpload.js.map