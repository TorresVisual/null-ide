'use strict';

import { TokenOptions, TokenProvider } from '../api';
import { ChangeEmitter } from '../changeEmitter';
import { Account, NewAccount } from '../types';
import {
  asRecord, DeviceCode, EXPIRY_MARGIN_MS, FormResponse, OAuthError, parseTokens, pollForToken, PostForm,
  refreshTokens, serializeTokens, startDeviceFlow, str, TokenSet,
} from './gitlabOAuth';

export const GITLAB_COM = 'gitlab.com';

/** gitlab.com uses `null-accounts.gitlab.clientId`; a self-hosted host needs its own entry in `hostClientIds`. */
export function resolveClientId(host: string, clientId: unknown, hostClientIds: unknown): string | undefined {
  const value = host === GITLAB_COM ? clientId : asRecord(hostClientIds)[host];
  return typeof value === 'string' ? str(value.trim()) : undefined;
}

export interface GitlabDeps {
  post: PostForm;
  /** GET https://<host>/api/v4<apiPath>, with a bearer token when given. Resolves any HTTP response; rejects only on a network failure. */
  get(host: string, apiPath: string, token?: string): Promise<FormResponse>;
  secrets: {
    get(id: string): PromiseLike<string | undefined>;
    set(id: string, value: string): Promise<void>;
  };
  clientIdFor(host: string): string | undefined;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Called once per account when its sign-in can no longer be refreshed. */
  onNeedsReauth(account: Account): void;
  /** Interactive `getToken` only: run the sign-in again (ui/accountPicker `reauthenticate`). */
  promptReauth(account: Account): Promise<void>;
}

export interface DeviceFlowUi {
  /** Show the user code and open the verification page. */
  show(code: DeviceCode): void;
  cancelled(): boolean;
}

export class GitlabProvider implements TokenProvider {
  private readonly emitter = new ChangeEmitter();
  /** Fires when an account's "needs re-auth" state changes. */
  readonly onDidChange = this.emitter.event;
  // In memory only: after a restart the next getToken retries the refresh and flags it again if it still fails.
  private readonly stale = new Set<string>();
  private readonly refreshing = new Map<string, Promise<string | undefined>>();

  constructor(private readonly deps: GitlabDeps) {}

  needsReauth(id: string): boolean {
    return this.stale.has(id);
  }

  /** Runs the device flow and describes who signed in. The caller stores `secret` with the account. */
  async signIn(host: string, ui: DeviceFlowUi): Promise<{ account: NewAccount; secret: string }> {
    const clientId = this.deps.clientIdFor(host);
    if (!clientId) {
      throw new Error(
        `No GitLab OAuth client ID is set for ${host}. Set null-accounts.gitlab.clientId (gitlab.com) or add "${host}" to null-accounts.gitlab.hostClientIds.`,
      );
    }
    await this.checkHost(host);
    const code = await startDeviceFlow(this.deps.post, host, clientId);
    ui.show(code);
    const tokens = await pollForToken(this.deps.post, host, clientId, code, {
      sleep: this.deps.sleep, now: this.deps.now, cancelled: () => ui.cancelled(),
    });
    return { account: await this.describeUser(host, tokens.accessToken, 'oauth'), secret: serializeTokens(tokens) };
  }

  /** Personal access token sign-in (for hosts where no OAuth app can be registered). The token is validated, then stored raw. */
  async signInWithToken(host: string, token: string): Promise<{ account: NewAccount; secret: string }> {
    const secret = token.trim();
    if (!secret) { throw new Error('An access token is required.'); }
    await this.checkHost(host);
    return { account: await this.describeUser(host, secret, 'https'), secret };
  }

  /** Reads /user with the token and builds the account it describes. */
  private async describeUser(host: string, token: string, authMethod: NewAccount['authMethod']): Promise<NewAccount> {
    const res = await this.deps.get(host, '/user', token);
    if (authMethod === 'https' && (res.status === 401 || res.status === 403)) {
      const b = asRecord(res.body);
      const why = str(b.error_description) ?? str(b.error) ?? str(b.message);
      const fix = /fine-grained/i.test(why ?? '')
        ? 'Create a fine-grained personal access token that includes the User: Read permission (plus the repository permissions you need) and try again.'
        : 'Create a personal access token with the api and write_repository scopes (read_api for read-only) and try again.';
      throw new Error(`${host} said the token was rejected (HTTP ${res.status}${why ? `: ${why}` : ''}). ${fix}`);
    }
    const user = asRecord(res.body);
    const username = str(user.username);
    if (res.status !== 200 || !username) {
      throw new Error(`Could not read the GitLab profile (HTTP ${res.status}).`);
    }
    const id = typeof user.id === 'number' ? String(user.id) : undefined;
    const bareHost = host.replace(/:\d+$/, '');
    return {
      provider: 'gitlab',
      host,
      username,
      email: str(user.email) ?? `${id ? `${id}-` : ''}${username}@users.noreply.${bareHost}`,
      authMethod,
      externalId: id,
    };
  }

  /** Signs in again and replaces the stored tokens; refuses a different GitLab user than the account's. */
  async reauthenticate(account: Account, ui: DeviceFlowUi): Promise<void> {
    const { account: who, secret } = await this.signIn(account.host, ui);
    if (who.username.toLowerCase() !== account.username.toLowerCase()) {
      throw new Error(`You signed in as ${who.username}, but this account is ${account.username}.`);
    }
    await this.deps.secrets.set(account.id, secret);
    this.unflag(account.id);
  }

  /** `_scopes` is ignored: GitLab scopes are fixed when the user signs in. */
  async getToken(account: Account, _scopes?: string[], options?: TokenOptions): Promise<string | undefined> {
    if (account.provider !== 'gitlab') { return undefined; }
    // ponytail: a revoked or expired token is only noticed when a feature using it fails; check /user from here if that proves too late.
    // A personal access token is used as is: it can't be refreshed, and the OAuth re-auth prompt doesn't apply to it.
    if (account.authMethod === 'https') { return (await this.deps.secrets.get(account.id)) || undefined; }
    const token = await this.usableToken(account);
    if (token || !options?.interactive) { return token; }
    await this.deps.promptReauth(account);
    return this.usableToken(account);
  }

  /** 200 or 401 from /api/v4/version means a GitLab API answered (it needs a token, so 401 is the normal reply). */
  // ponytail: any https server answering 401 passes; the OAuth call that follows is the real check.
  private async checkHost(host: string): Promise<void> {
    const res = await this.deps.get(host, '/version').catch(() => undefined);
    if (!res) { throw new Error(`Could not reach ${host}.`); }
    if (res.status !== 200 && res.status !== 401) {
      throw new Error(`${host} does not look like a GitLab server (HTTP ${res.status}).`);
    }
  }

  private async usableToken(account: Account): Promise<string | undefined> {
    const tokens = parseTokens(await this.deps.secrets.get(account.id));
    if (!tokens) {
      this.flag(account);
      return undefined;
    }
    if (tokens.expiresAt === undefined || tokens.expiresAt - EXPIRY_MARGIN_MS > this.deps.now()) {
      this.unflag(account.id);
      return tokens.accessToken;
    }
    if (this.stale.has(account.id)) { return undefined; } // already known dead; don't hit the server on every call
    let pending = this.refreshing.get(account.id);
    if (!pending) {
      // GitLab rotates the refresh token: a second parallel refresh would send the spent one and be rejected.
      pending = this.refresh(account, tokens).finally(() => this.refreshing.delete(account.id));
      this.refreshing.set(account.id, pending);
    }
    return pending;
  }

  private async refresh(account: Account, old: TokenSet): Promise<string | undefined> {
    if (!old.refreshToken) {
      this.flag(account);
      return undefined;
    }
    const clientId = this.deps.clientIdFor(account.host);
    if (!clientId) { return undefined; } // a settings problem, not a dead sign-in
    try {
      const fresh = await refreshTokens(this.deps.post, account.host, clientId, old.refreshToken, this.deps.now);
      const next: TokenSet = { ...fresh, refreshToken: fresh.refreshToken ?? old.refreshToken };
      await this.deps.secrets.set(account.id, serializeTokens(next));
      return next.accessToken;
    } catch (err) {
      if (err instanceof OAuthError && err.reason === 'rejected') { this.flag(account); }
      return undefined; // offline / 5xx: leave the tokens, try again on the next call
    }
  }

  private flag(account: Account): void {
    if (this.stale.has(account.id)) { return; }
    this.stale.add(account.id);
    this.emitter.fire();
    this.deps.onNeedsReauth(account);
  }

  private unflag(id: string): void {
    if (this.stale.delete(id)) { this.emitter.fire(); }
  }
}

const readBody = (res: Response): Promise<unknown> => res.json().catch(() => undefined);

/** The real `GitlabDeps.post`. `redirect: 'error'` keeps a token request from being bounced to another host. */
export const fetchPostForm: PostForm = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'null-ide' },
    body: new URLSearchParams(form),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await readBody(res) };
};

/** The real `GitlabDeps.get`. */
export async function fetchGitlab(host: string, apiPath: string, token?: string): Promise<FormResponse> {
  const res = await fetch(`https://${host}/api/v4${apiPath}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'null-ide', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await readBody(res) };
}
