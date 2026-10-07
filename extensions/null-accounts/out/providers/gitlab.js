'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPostForm = exports.GitlabProvider = exports.GITLAB_COM = void 0;
exports.resolveClientId = resolveClientId;
exports.fetchGitlab = fetchGitlab;
const changeEmitter_1 = require("../changeEmitter");
const gitlabOAuth_1 = require("./gitlabOAuth");
exports.GITLAB_COM = 'gitlab.com';
/** gitlab.com uses `null-accounts.gitlab.clientId`; a self-hosted host needs its own entry in `hostClientIds`. */
function resolveClientId(host, clientId, hostClientIds) {
    const value = host === exports.GITLAB_COM ? clientId : (0, gitlabOAuth_1.asRecord)(hostClientIds)[host];
    return typeof value === 'string' ? (0, gitlabOAuth_1.str)(value.trim()) : undefined;
}
class GitlabProvider {
    deps;
    emitter = new changeEmitter_1.ChangeEmitter();
    /** Fires when an account's "needs re-auth" state changes. */
    onDidChange = this.emitter.event;
    // In memory only: after a restart the next getToken retries the refresh and flags it again if it still fails.
    stale = new Set();
    refreshing = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    needsReauth(id) {
        return this.stale.has(id);
    }
    /** Runs the device flow and describes who signed in. The caller stores `secret` with the account. */
    async signIn(host, ui) {
        const clientId = this.deps.clientIdFor(host);
        if (!clientId) {
            throw new Error(`No GitLab OAuth client ID is set for ${host}. Set null-accounts.gitlab.clientId (gitlab.com) or add "${host}" to null-accounts.gitlab.hostClientIds.`);
        }
        await this.checkHost(host);
        const code = await (0, gitlabOAuth_1.startDeviceFlow)(this.deps.post, host, clientId);
        ui.show(code);
        const tokens = await (0, gitlabOAuth_1.pollForToken)(this.deps.post, host, clientId, code, {
            sleep: this.deps.sleep, now: this.deps.now, cancelled: () => ui.cancelled(),
        });
        const res = await this.deps.get(host, '/user', tokens.accessToken);
        const user = (0, gitlabOAuth_1.asRecord)(res.body);
        const username = (0, gitlabOAuth_1.str)(user.username);
        if (res.status !== 200 || !username) {
            throw new Error(`Could not read the GitLab profile (HTTP ${res.status}).`);
        }
        const id = typeof user.id === 'number' ? String(user.id) : undefined;
        const bareHost = host.replace(/:\d+$/, '');
        return {
            account: {
                provider: 'gitlab',
                host,
                username,
                email: (0, gitlabOAuth_1.str)(user.email) ?? `${id ? `${id}-` : ''}${username}@users.noreply.${bareHost}`,
                authMethod: 'oauth',
                externalId: id,
            },
            secret: (0, gitlabOAuth_1.serializeTokens)(tokens),
        };
    }
    /** Signs in again and replaces the stored tokens; refuses a different GitLab user than the account's. */
    async reauthenticate(account, ui) {
        const { account: who, secret } = await this.signIn(account.host, ui);
        if (who.username.toLowerCase() !== account.username.toLowerCase()) {
            throw new Error(`You signed in as ${who.username}, but this account is ${account.username}.`);
        }
        await this.deps.secrets.set(account.id, secret);
        this.unflag(account.id);
    }
    /** `_scopes` is ignored: GitLab scopes are fixed when the user signs in. */
    async getToken(account, _scopes, options) {
        if (account.provider !== 'gitlab') {
            return undefined;
        }
        const token = await this.usableToken(account);
        if (token || !options?.interactive) {
            return token;
        }
        await this.deps.promptReauth(account);
        return this.usableToken(account);
    }
    /** 200 or 401 from /api/v4/version means a GitLab API answered (it needs a token, so 401 is the normal reply). */
    // ponytail: any https server answering 401 passes; the OAuth call that follows is the real check.
    async checkHost(host) {
        const res = await this.deps.get(host, '/version').catch(() => undefined);
        if (!res) {
            throw new Error(`Could not reach ${host}.`);
        }
        if (res.status !== 200 && res.status !== 401) {
            throw new Error(`${host} does not look like a GitLab server (HTTP ${res.status}).`);
        }
    }
    async usableToken(account) {
        const tokens = (0, gitlabOAuth_1.parseTokens)(await this.deps.secrets.get(account.id));
        if (!tokens) {
            this.flag(account);
            return undefined;
        }
        if (tokens.expiresAt === undefined || tokens.expiresAt - gitlabOAuth_1.EXPIRY_MARGIN_MS > this.deps.now()) {
            this.unflag(account.id);
            return tokens.accessToken;
        }
        if (this.stale.has(account.id)) {
            return undefined;
        } // already known dead; don't hit the server on every call
        let pending = this.refreshing.get(account.id);
        if (!pending) {
            // GitLab rotates the refresh token: a second parallel refresh would send the spent one and be rejected.
            pending = this.refresh(account, tokens).finally(() => this.refreshing.delete(account.id));
            this.refreshing.set(account.id, pending);
        }
        return pending;
    }
    async refresh(account, old) {
        if (!old.refreshToken) {
            this.flag(account);
            return undefined;
        }
        const clientId = this.deps.clientIdFor(account.host);
        if (!clientId) {
            return undefined;
        } // a settings problem, not a dead sign-in
        try {
            const fresh = await (0, gitlabOAuth_1.refreshTokens)(this.deps.post, account.host, clientId, old.refreshToken, this.deps.now);
            const next = { ...fresh, refreshToken: fresh.refreshToken ?? old.refreshToken };
            await this.deps.secrets.set(account.id, (0, gitlabOAuth_1.serializeTokens)(next));
            return next.accessToken;
        }
        catch (err) {
            if (err instanceof gitlabOAuth_1.OAuthError && err.reason === 'rejected') {
                this.flag(account);
            }
            return undefined; // offline / 5xx: leave the tokens, try again on the next call
        }
    }
    flag(account) {
        if (this.stale.has(account.id)) {
            return;
        }
        this.stale.add(account.id);
        this.emitter.fire();
        this.deps.onNeedsReauth(account);
    }
    unflag(id) {
        if (this.stale.delete(id)) {
            this.emitter.fire();
        }
    }
}
exports.GitlabProvider = GitlabProvider;
const readBody = (res) => res.json().catch(() => undefined);
/** The real `GitlabDeps.post`. `redirect: 'error'` keeps a token request from being bounced to another host. */
const fetchPostForm = async (url, form) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'null-ide' },
        body: new URLSearchParams(form),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, body: await readBody(res) };
};
exports.fetchPostForm = fetchPostForm;
/** The real `GitlabDeps.get`. */
async function fetchGitlab(host, apiPath, token) {
    const res = await fetch(`https://${host}/api/v4${apiPath}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'null-ide', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, body: await readBody(res) };
}
//# sourceMappingURL=gitlab.js.map