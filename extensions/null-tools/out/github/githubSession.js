'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGithubSession = resolveGithubSession;
const SCOPES = ['repo'];
/**
 * The token and login of the GitHub account bound to `folder`. Silent callers get `undefined` for an
 * unbound folder; interactive callers are asked to pick or add an account first.
 */
async function resolveGithubSession(api, folder, interactive) {
    if (!api || !folder) {
        return undefined;
    }
    let account = api.getAccountForFolder(folder);
    if (!account && interactive) {
        account = await api.ensureAccountForFolder(folder);
    }
    if (account?.provider !== 'github') {
        return undefined;
    }
    const accessToken = await api.getToken(account, SCOPES, { interactive });
    return accessToken ? { accessToken, login: account.username } : undefined;
}
//# sourceMappingURL=githubSession.js.map