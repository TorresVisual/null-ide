'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubProvider = exports.GITHUB_SCOPES = void 0;
exports.fetchGithub = fetchGithub;
/** `repo` is what the Issues panel needs; `user:email` lets us read the primary email; `workflow` lets the token we store for git push `.github/workflows` files. */
exports.GITHUB_SCOPES = ['repo', 'user:email', 'workflow'];
/** The real `GithubDeps.api`. */
async function fetchGithub(path, token) {
    const res = await fetch(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'null-ide' },
    });
    if (!res.ok) {
        throw new Error(`GitHub API ${res.status} for ${path}`);
    }
    return res.json();
}
/** Wraps VS Code's built-in `github` auth provider; it keeps the tokens, we keep who they belong to. */
class GithubProvider {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Forces a fresh sign-in (so a second account can be added) and describes who signed in. `undefined` if the user cancels. */
    async signIn() {
        const session = await this.deps.getSession(exports.GITHUB_SCOPES, { forceNewSession: true }).then(s => s, () => undefined);
        return session ? this.describe(session) : undefined;
    }
    /** The account VS Code is already signed in with, without prompting. */
    async existing() {
        const session = await this.deps.getSession(exports.GITHUB_SCOPES, { silent: true }).then(s => s, () => undefined);
        return session ? this.describe(session) : undefined;
    }
    async getToken(account, scopes, options) {
        if (account.provider !== 'github' || !account.externalId) {
            return undefined;
        }
        const wanted = [...new Set([...exports.GITHUB_SCOPES, ...(scopes ?? [])])];
        const target = { id: account.externalId, label: account.username };
        const session = await this.deps.getSession(wanted, options?.interactive ? { account: target, createIfNone: true } : { account: target, silent: true });
        // A prompt can end with the user signing in as someone else; never hand back that identity's token.
        return session?.account.id === account.externalId ? session.accessToken : undefined;
    }
    async describe(session) {
        const user = await this.deps.api('/user', session.accessToken);
        const emails = await this.deps.api('/user/emails', session.accessToken)
            .then(list => (Array.isArray(list) ? list : []), () => []);
        const primary = emails.find(e => e.primary && e.verified)?.email;
        return {
            provider: 'github',
            host: 'github.com',
            username: user.login,
            email: primary ?? user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
            authMethod: 'oauth',
            externalId: session.account.id,
        };
    }
}
exports.GithubProvider = GithubProvider;
//# sourceMappingURL=github.js.map