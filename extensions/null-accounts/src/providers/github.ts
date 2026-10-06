'use strict';

import type * as vscode from 'vscode';
import { TokenOptions, TokenProvider } from '../api';
import { Account, NewAccount } from '../types';

/** `repo` is what the Issues panel needs; `user:email` lets us read the primary email. */
export const GITHUB_SCOPES = ['repo', 'user:email'];

export interface GithubDeps {
  getSession(
    scopes: readonly string[],
    options: vscode.AuthenticationGetSessionOptions,
  ): Thenable<vscode.AuthenticationSession | undefined>;
  /** GET https://api.github.com<path> with the token; resolves the parsed JSON, rejects on a non-2xx status. */
  api(path: string, token: string): Promise<unknown>;
}

/** The real `GithubDeps.api`. */
export async function fetchGithub(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'null-ide' },
  });
  if (!res.ok) { throw new Error(`GitHub API ${res.status} for ${path}`); }
  return res.json();
}

interface GithubUser { id: number; login: string; email?: string | null }
interface GithubEmail { email: string; primary: boolean; verified: boolean }

/** Wraps VS Code's built-in `github` auth provider; it keeps the tokens, we keep who they belong to. */
export class GithubProvider implements TokenProvider {
  constructor(private readonly deps: GithubDeps) {}

  /** Forces a fresh sign-in (so a second account can be added) and describes who signed in. `undefined` if the user cancels. */
  async signIn(): Promise<NewAccount | undefined> {
    const session = await this.deps.getSession(GITHUB_SCOPES, { forceNewSession: true }).then(s => s, () => undefined);
    return session ? this.describe(session) : undefined;
  }

  /** The account VS Code is already signed in with, without prompting. */
  async existing(): Promise<NewAccount | undefined> {
    const session = await this.deps.getSession(GITHUB_SCOPES, { silent: true }).then(s => s, () => undefined);
    return session ? this.describe(session) : undefined;
  }

  async getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined> {
    if (account.provider !== 'github' || !account.externalId) { return undefined; }
    const wanted = [...new Set([...GITHUB_SCOPES, ...(scopes ?? [])])];
    const target = { id: account.externalId, label: account.username };
    const session = await this.deps.getSession(
      wanted,
      options?.interactive ? { account: target, createIfNone: true } : { account: target, silent: true },
    );
    // A prompt can end with the user signing in as someone else; never hand back that identity's token.
    return session?.account.id === account.externalId ? session.accessToken : undefined;
  }

  private async describe(session: vscode.AuthenticationSession): Promise<NewAccount> {
    const user = await this.deps.api('/user', session.accessToken) as GithubUser;
    const emails = await this.deps.api('/user/emails', session.accessToken)
      .then(list => (Array.isArray(list) ? list as GithubEmail[] : []), () => [] as GithubEmail[]);
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
